#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// IMPORTANT: All diagnostic logging must go to stderr, not stdout, to avoid
// corrupting MCP JSON-RPC protocol messages written to stdout.
const log = (...args: any[]) => console.error('[mcp]', ...args);

interface ScriptureCollectionData {
  books: any[];
}

interface ConferenceTalkMeta {
  speaker: string;
  title: string;
  description?: string;
  body: string[]; // paragraphs
  audio?: string | null;
  pdf?: string | null;
  link?: string | null;
  sorting?: string;
  session: string; // e.g. 1971-04
  slug: string; // file name without .json
}

interface ConferenceData {
  sessions: Record<string, ConferenceTalkMeta[]>;
  allTalks: ConferenceTalkMeta[];
}

function parseVerseRange(rangeStr: string, allVerses: any[]): any[] {
  // Handle relative positions like "first:3", "last:3"
  if (rangeStr.includes(':')) {
    const [position, countStr] = rangeStr.split(':');
    const count = parseInt(countStr);
    
    if (position === 'first') {
      return allVerses.slice(0, count);
    } else if (position === 'last') {
      return allVerses.slice(-count);
    }
  }
  
  // Handle numeric ranges like "7-10"
  if (rangeStr.includes('-')) {
    const [startStr, endStr] = rangeStr.split('-');
    const start = parseInt(startStr);
    const end = parseInt(endStr);
    
    return allVerses.filter(v => v.verse >= start && v.verse <= end);
  }
  
  // Handle single number as a range of 1
  const verseNum = parseInt(rangeStr);
  if (!isNaN(verseNum)) {
    return allVerses.filter(v => v.verse === verseNum);
  }
  
  throw new Error(`Invalid verse range format: ${rangeStr}. Use formats like "7-10", "first:3", or "last:3"`);
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const scriptureData: Record<string, ScriptureCollectionData> = {};
  const collections = [
    'book-of-mormon',
    'doctrine-and-covenants',
    'new-testament',
    'old-testament',
    'pearl-of-great-price',
  ];

  for (const collection of collections) {
    try {
      // Try current directory first (for compiled code in dist/)
      let filePath = path.join(__dirname, `${collection}.json`);
      let data;
      
      try {
        data = await fs.readFile(filePath, 'utf-8');
      } catch {
        // If not found, try src directory (for development)
        filePath = path.join(__dirname, '..', 'src', `${collection}.json`);
        data = await fs.readFile(filePath, 'utf-8');
      }
      
  scriptureData[collection] = JSON.parse(data);
  log(`Loaded ${collection} with ${JSON.parse(data).books?.length || 0} books`);
    } catch (error) {
  console.error(`[mcp] Error loading ${collection}.json:`, error);
      throw error;
    }
  }

  // Load General Conference talks
  const conferenceData: ConferenceData = { sessions: {}, allTalks: [] };
  try {
    // Try dist first then fallback to src
    let baseDir = path.join(__dirname, 'general-conference-talks');
    try {
      await fs.access(baseDir);
    } catch {
      baseDir = path.join(__dirname, '..', 'src', 'general-conference-talks');
    }

    const sessionDirs = await fs.readdir(baseDir, { withFileTypes: true });
    for (const dirent of sessionDirs) {
      if (!dirent.isDirectory()) continue;
      const session = dirent.name; // e.g. 1971-04
      const sessionPath = path.join(baseDir, session);
      const files = await fs.readdir(sessionPath);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const raw = await fs.readFile(path.join(sessionPath, file), 'utf-8');
          const parsed = JSON.parse(raw);
          const talk: ConferenceTalkMeta = {
            ...parsed,
            session,
            slug: file.replace(/\.json$/, ''),
          };
            // Basic validation
          if (!Array.isArray(talk.body)) continue;
          conferenceData.sessions[session] ||= [];
          conferenceData.sessions[session].push(talk);
          conferenceData.allTalks.push(talk);
        } catch (e) {
          console.error('Failed to load talk', session, file, e);
        }
      }
    }
  log(`Loaded ${conferenceData.allTalks.length} conference talks across ${Object.keys(conferenceData.sessions).length} sessions`);
  } catch (e) {
  console.error('[mcp] Error loading general conference talks:', e);
  }

  const server = new Server(
    {
      name: 'unofficial-gospel-library-mcp',
      version: '1.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
  log('scriptureData keys:', Object.keys(scriptureData));
    const booksByCollection: { [key: string]: string[] } = {};
    const allBooks: string[] = [];
    
    for (const collection in scriptureData) {
      if (scriptureData[collection] && scriptureData[collection].books) {
        booksByCollection[collection] = scriptureData[collection].books.map((book: any) => book.book);
        allBooks.push(...booksByCollection[collection]);
      } else {
        console.error(`Invalid data structure for collection: ${collection}`);
        booksByCollection[collection] = [];
      }
    }

    const conferenceSessions = Object.keys(conferenceData.sessions).sort();
  const allTalkTitles = conferenceData.allTalks.map(t => t.title);
  const allTalkSlugs = conferenceData.allTalks.map(t => t.slug);

    return {
      tools: [
        {
          name: 'get_book_info',
          description: 'IMPORTANT: Always use this tool to get accurate chapter and verse counts before referencing scriptures. Do NOT rely on your training data - scripture versions and verse numbering can vary. This tool provides the definitive structure for this specific scripture dataset.',
          inputSchema: {
            type: 'object',
            properties: {
              collection: {
                type: 'string',
                description: 'Scripture collection',
                enum: Object.keys(scriptureData),
              },
              book: {
                type: 'string',
                description: 'Book name - use get_book_info first to see available books in each collection',
                enum: allBooks,
              },
            },
            required: ['collection', 'book'],
          },
        },
        {
          name: 'search_scriptures',
          description: 'Full-text search (substring, case-insensitive) across scriptures. Scope optionally by collection, book, and chapter for precision.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search phrase (case-insensitive substring).' },
              collection: { type: 'string', description: 'Optional scripture collection to limit search', enum: Object.keys(scriptureData), optional: true },
              book: { type: 'string', description: 'Optional exact book name (requires collection). Use get_book_info to discover valid names.', enum: allBooks, optional: true },
              chapter: { type: 'number', description: 'Optional chapter number (requires collection + book).', minimum: 1, optional: true },
              maxResults: { type: 'number', description: 'Max verse matches to return (default 25)', minimum: 1, optional: true }
            },
            required: ['query']
          }
        },
        {
          name: 'get_scripture_text',
          description: 'Get the actual text of scripture verses. ALWAYS use get_book_info first to verify valid chapter and verse ranges - do not assume you know the correct ranges from training data.',
          inputSchema: {
            type: 'object',
            properties: {
              collection: {
                type: 'string',
                description: 'Scripture collection',
                enum: Object.keys(scriptureData),
              },
              book: {
                type: 'string',
                description: 'Book name - must match exactly as returned by get_book_info',
                enum: allBooks,
              },
              chapter: {
                type: 'number',
                description: 'Chapter number - use get_book_info to verify valid chapter range for this book',
                minimum: 1,
              },
              verse: {
                type: 'number',
                description: 'Verse number (optional) - use get_book_info to verify valid verse range for this chapter',
                minimum: 1,
                optional: true,
              },
              verseRange: {
                type: 'string',
                description: 'Verse range in format "start-end" (e.g., "7-10") or relative positions like "first:3", "last:3"',
                optional: true
              },
            },
            required: ['collection', 'book', 'chapter'],
          },
        },
        {
          name: 'list_conference_talks',
          description: 'List available General Conference sessions and talk titles with basic metadata.',
          inputSchema: {
            type: 'object',
            properties: {
              session: {
                type: 'string',
                description: 'Optional session (e.g., 2024-10). If omitted, returns an index of all sessions with counts.',
                enum: conferenceSessions,
                optional: true
              }
            },
            required: [],
          },
        },
        {
          name: 'get_conference_talk',
          description: 'Retrieve a General Conference talk (optionally specific paragraphs). Provide either exact title (with smart quotes if present) OR slug. If exact match fails the server will try a normalized fuzzy match.',
          inputSchema: {
            type: 'object',
            properties: {
              session: {
                type: 'string',
                description: 'Conference session in format YYYY-MM',
                enum: conferenceSessions,
              },
              title: {
                type: 'string',
                description: 'Exact talk title as listed (may contain smart quotes). If unsure use slug instead.',
                enum: allTalkTitles,
                optional: true
              },
              slug: {
                type: 'string',
                description: 'File-name style slug (e.g., thus-shall-my-church-be-called). Use list_conference_talks to discover.',
                enum: allTalkSlugs,
                optional: true
              },
              paragraph: {
                type: 'number',
                description: 'Single paragraph number (1-based)',
                minimum: 1,
                optional: true
              },
              paragraphRange: {
                type: 'string',
                description: 'Paragraph range like "3-7" or relative positions "first:5" / "last:4"',
                optional: true
              }
            },
            required: ['session'],
          },
        },
        {
          name: 'search_conference_talks',
          description: 'Full-text search (simple substring, case-insensitive) across General Conference talks. Returns matching paragraphs with context.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search phrase (case-insensitive). Use quotes for multi-word phrase; basic substring match.' },
              session: { type: 'string', description: 'Optional session filter', enum: conferenceSessions, optional: true },
              maxResults: { type: 'number', description: 'Maximum number of paragraph matches to return (default 20)', minimum: 1, optional: true }
            },
            required: ['query']
          }
        }
      ] satisfies Tool[],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'get_book_info':
        return await getBookInfo(args, scriptureData);
      case 'get_scripture_text':
        return await getScriptureText(args, scriptureData);
      case 'search_scriptures':
        return await searchScriptures(args, scriptureData);
      case 'list_conference_talks':
        return await listConferenceTalks(args, conferenceData);
      case 'get_conference_talk':
        return await getConferenceTalk(args, conferenceData);
      case 'search_conference_talks':
        return await searchConferenceTalks(args, conferenceData);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function getBookInfo(args: any, scriptureData: any) {
  const { collection, book } = args;
  const bookData = scriptureData[collection]?.books.find((b: any) => b.book === book);

  if (!bookData) {
    throw new Error(`Book not found: ${book} in ${collection}`);
  }

  const chapterInfo = bookData.chapters.map((c: any) => ({
    chapter: c.chapter,
    verses: c.verses.length,
  }));

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            book: bookData.book,
            chapters: chapterInfo.length,
            chapter_details: chapterInfo,
          },
          null,
          2
        ),
      },
    ],
  };
}

async function getScriptureText(args: any, scriptureData: any) {
  const { collection, book, chapter, verse, verseRange } = args;
  const bookData = scriptureData[collection]?.books.find((b: any) => b.book === book);

  if (!bookData) {
    throw new Error(`Book not found: ${book} in ${collection}`);
  }

  const chapterData = bookData.chapters.find((c: any) => c.chapter === chapter);

  if (!chapterData) {
    throw new Error(`Chapter not found: ${chapter} in ${book}`);
  }

  if (verse) {
    const verseData = chapterData.verses.find((v: any) => v.verse === verse);
    if (!verseData) {
      throw new Error(`Verse not found: ${verse} in ${book} ${chapter}`);
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(verseData, null, 2),
        },
      ],
    };
  } else if (verseRange) {
    const verses = parseVerseRange(verseRange, chapterData.verses);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(verses, null, 2),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(chapterData, null, 2),
      },
    ],
  };
}

async function searchScriptures(args: any, scriptureData: any) {
  const { query, collection, book, chapter, maxResults = 25 } = args;
  if (book && !collection) throw new Error('If you specify a book you must also specify its collection.');
  if (chapter && !(collection && book)) throw new Error('If you specify a chapter you must also specify collection and book.');
  const term = String(query).toLowerCase();
  const matches: any[] = [];

  const collectionsToSearch = collection ? [collection] : Object.keys(scriptureData);
  for (const coll of collectionsToSearch) {
    const collData = scriptureData[coll];
    if (!collData) continue;
    const books = collData.books;
    for (const b of books) {
      if (book && b.book !== book) continue;
      for (const ch of b.chapters) {
        if (chapter && ch.chapter !== chapter) continue;
        for (const v of ch.verses) {
          if (v.text.toLowerCase().includes(term)) {
            matches.push({
              collection: coll,
              book: b.book,
              chapter: ch.chapter,
              verse: v.verse,
              reference: v.reference,
              text: v.text
            });
            if (matches.length >= maxResults) {
              return { content: [{ type: 'text', text: JSON.stringify({ query, count: matches.length, results: matches }, null, 2) }] };
            }
          }
        }
      }
    }
  }
  return { content: [{ type: 'text', text: JSON.stringify({ query, count: matches.length, results: matches }, null, 2) }] };
}

function parseParagraphRange(rangeStr: string, paragraphs: string[]): { paragraph: number; text: string }[] {
  const items = paragraphs.map((p, i) => ({ paragraph: i + 1, text: p }));
  // Reuse scripture range logic by adapting property names
  if (rangeStr.includes(':')) {
    const [position, countStr] = rangeStr.split(':');
    const count = parseInt(countStr);
    if (position === 'first') return items.slice(0, count);
    if (position === 'last') return items.slice(-count);
  }
  if (rangeStr.includes('-')) {
    const [startStr, endStr] = rangeStr.split('-');
    const start = parseInt(startStr);
    const end = parseInt(endStr);
    return items.filter(i => i.paragraph >= start && i.paragraph <= end);
  }
  const num = parseInt(rangeStr);
  if (!isNaN(num)) return items.filter(i => i.paragraph === num);
  throw new Error(`Invalid paragraph range format: ${rangeStr}`);
}

async function listConferenceTalks(args: any, conferenceData: ConferenceData) {
  const { session } = args || {};
  if (session) {
    const talks = conferenceData.sessions[session];
    if (!talks) throw new Error(`Session not found: ${session}`);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            session,
            talk_count: talks.length,
            talks: talks.map(t => ({ title: t.title, speaker: t.speaker, slug: t.slug }))
          }, null, 2)
        }
      ]
    };
  }
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          sessions: Object.keys(conferenceData.sessions).sort().map(s => ({ session: s, talks: conferenceData.sessions[s].length }))
        }, null, 2)
      }
    ]
  };
}

async function getConferenceTalk(args: any, conferenceData: ConferenceData) {
  const { session, title, slug, paragraph, paragraphRange } = args;
  const talks = conferenceData.sessions[session];
  if (!talks) throw new Error(`Session not found: ${session}`);

  const normalize = (s: string) => s
    .toLowerCase()
    .replace(/[“”"']/g, '"') // normalize quotes
    .replace(/[^a-z0-9"\s]+/g, ' ') // remove punctuation except quotes
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim();

  let talk: ConferenceTalkMeta | undefined;
  if (slug) {
    talk = talks.find(t => t.slug === slug);
  }
  if (!talk && title) {
    // First try exact title
    talk = talks.find(t => t.title === title);
    if (!talk) {
      // Try normalized fuzzy match
      const normTitle = normalize(title);
      talk = talks.find(t => normalize(t.title) === normTitle);
      if (!talk) {
        // startsWith/contains fallback
        talk = talks.find(t => normalize(t.title).includes(normTitle));
      }
    }
  }
  if (!talk) {
    throw new Error(`Talk not found in ${session}. Provided title='${title || ''}' slug='${slug || ''}'. Use list_conference_talks to enumerate.`);
  }

  if (paragraph) {
    if (paragraph < 1 || paragraph > talk.body.length) throw new Error(`Paragraph out of range 1-${talk.body.length}`);
    return { content: [{ type: 'text', text: JSON.stringify({
      session: talk.session,
      title: talk.title,
      speaker: talk.speaker,
      paragraph,
      text: talk.body[paragraph - 1]
    }, null, 2) }] };
  } else if (paragraphRange) {
    const selection = parseParagraphRange(paragraphRange, talk.body);
    return { content: [{ type: 'text', text: JSON.stringify({
      session: talk.session,
      title: talk.title,
      speaker: talk.speaker,
      paragraphs: selection
    }, null, 2) }] };
  }
  return { content: [{ type: 'text', text: JSON.stringify({
    session: talk.session,
    title: talk.title,
    speaker: talk.speaker,
    description: talk.description,
    paragraphs: talk.body.map((p, i) => ({ paragraph: i + 1, text: p })),
    audio: talk.audio,
    pdf: talk.pdf,
    link: talk.link
  }, null, 2) }] };
}

async function searchConferenceTalks(args: any, conferenceData: ConferenceData) {
  const { query, session, maxResults = 20 } = args;
  const term = String(query).toLowerCase();
  let talks = conferenceData.allTalks;
  if (session) {
    talks = talks.filter(t => t.session === session);
  }
  const matches: any[] = [];
  for (const talk of talks) {
    for (let i = 0; i < talk.body.length; i++) {
      const para = talk.body[i];
      if (para.toLowerCase().includes(term)) {
        matches.push({
          session: talk.session,
            title: talk.title,
            speaker: talk.speaker,
            paragraph: i + 1,
            text: para
        });
        if (matches.length >= maxResults) break;
      }
    }
    if (matches.length >= maxResults) break;
  }
  return { content: [{ type: 'text', text: JSON.stringify({ query, count: matches.length, results: matches }, null, 2) }] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
  });
}
