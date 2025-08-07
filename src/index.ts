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

  const scriptureData: any = {};
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
      console.log(`Loaded ${collection} with ${JSON.parse(data).books?.length || 0} books`);
    } catch (error) {
      console.error(`Error loading ${collection}.json:`, error);
      throw error;
    }
  }

  const server = new Server(
    {
      name: 'unofficial-gospel-library-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    console.log('scriptureData keys:', Object.keys(scriptureData));
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
  });
}
