#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

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

const BASE_URL = 'https://www.churchofjesuschrist.org/study';

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

const SCRIPTURE_COLLECTIONS = {
  'old-testament': 'ot',
  'new-testament': 'nt', 
  'book-of-mormon': 'bofm',
  'doctrine-and-covenants': 'dc-testament',
  'pearl-of-great-price': 'pgp'
};

const SCRIPTURE_BOOKS = {
  'old-testament': ['gen', 'ex', 'lev', 'num', 'deut', 'josh', 'judg', 'ruth', '1-sam', '2-sam', '1-kgs', '2-kgs', '1-chr', '2-chr', 'ezra', 'neh', 'esth', 'job', 'ps', 'prov', 'eccl', 'song', 'isa', 'jer', 'lam', 'ezek', 'dan', 'hosea', 'joel', 'amos', 'obad', 'jonah', 'micah', 'nahum', 'hab', 'zeph', 'hag', 'zech', 'mal'],
  'new-testament': ['matt', 'mark', 'luke', 'john', 'acts', 'rom', '1-cor', '2-cor', 'gal', 'eph', 'philip', 'col', '1-thes', '2-thes', '1-tim', '2-tim', 'titus', 'philem', 'heb', 'james', '1-pet', '2-pet', '1-jn', '2-jn', '3-jn', 'jude', 'rev'],
  'book-of-mormon': ['1-ne', '2-ne', 'jacob', 'enos', 'jarom', 'omni', 'w-of-m', 'mosiah', 'alma', 'hel', '3-ne', '4-ne', 'morm', 'ether', 'moro'],
  'doctrine-and-covenants': ['dc'],
  'pearl-of-great-price': ['moses', 'abr', 'js-m', 'js-h', 'a-of-f']
};

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_scripture',
        description: 'Get scripture text from Gospel Library by reference (book, chapter, verse, or verse ranges)',
        inputSchema: {
          type: 'object',
          properties: {
            collection: {
              type: 'string',
              enum: Object.keys(SCRIPTURE_COLLECTIONS),
              description: 'Scripture collection (old-testament, new-testament, book-of-mormon, doctrine-and-covenants, pearl-of-great-price)'
            },
            book: {
              type: 'string',
              description: 'Book abbreviation or name (e.g., "1-ne", "alma", "matt", "gen")',
              enum: [
                ...SCRIPTURE_BOOKS['old-testament'],
                ...SCRIPTURE_BOOKS['new-testament'],
                ...SCRIPTURE_BOOKS['book-of-mormon'],
                ...SCRIPTURE_BOOKS['doctrine-and-covenants'],
                ...SCRIPTURE_BOOKS['pearl-of-great-price']
              ]
            },
            chapter: {
              type: 'number',
              description: 'Chapter number'
            },
            verse: {
              type: 'number',
              description: 'Specific verse number (optional - if not provided, returns entire chapter)',
              optional: true
            },
            verseRange: {
              type: 'string',
              description: 'Verse range in format "start-end" (e.g., "7-10") or relative positions like "first:3", "last:3"',
              optional: true
            },
            language: {
              type: 'string',
              description: 'Language code (default: eng)',
              default: 'eng',
              optional: true
            }
          },
          required: ['collection', 'book', 'chapter']
        }
      },
      {
        name: 'search_scriptures',
        description: 'Search for text within Gospel Library scriptures',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Text to search for in scriptures'
            },
            collection: {
              type: 'string',
              enum: Object.keys(SCRIPTURE_COLLECTIONS),
              description: 'Scripture collection to search within (optional - searches all if not specified)',
              optional: true
            },
            language: {
              type: 'string',
              description: 'Language code (default: eng)',
              default: 'eng',
              optional: true
            }
          },
          required: ['query']
        }
      }
    ] satisfies Tool[]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'get_scripture':
      return await getScripture(args);
    case 'search_scriptures':
      return await searchScriptures(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function getScripture(args: any) {
  const { collection, book, chapter, verse, verseRange, language = 'eng' } = args;
  
  const collectionCode = SCRIPTURE_COLLECTIONS[collection as keyof typeof SCRIPTURE_COLLECTIONS];
  if (!collectionCode) {
    throw new Error(`Invalid collection: ${collection}`);
  }

  const url = `${BASE_URL}/scriptures/${collectionCode}/${book}/${chapter}?lang=${language}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch scripture: ${response.status} ${response.statusText}`);
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Collect all verses first
    const allVerses: any[] = [];
    $('.verse').each((_, element) => {
      const id = $(element).attr('id');
      const verseNum = id?.match(/p(\d+)/)?.[1];
      const text = $(element).text().trim();
      if (verseNum && text) {
        allVerses.push({
          verse: parseInt(verseNum),
          text: text
        });
      }
    });

    let result: any = {
      reference: `${collection} ${book} ${chapter}`,
      url: url,
      language: language,
      chapterTitle: $('h1').first().text().trim()
    };

    if (verse) {
      const foundVerse = allVerses.find(v => v.verse === verse);
      if (!foundVerse) {
        throw new Error(`Verse ${verse} not found in ${collection} ${book} ${chapter}`);
      }
      result.reference += `:${verse}`;
      result.text = foundVerse.text;
      result.verse = verse;
    } else if (verseRange) {
      const verses = parseVerseRange(verseRange, allVerses);
      result.verses = verses;
      result.reference += `:${verses[0].verse}-${verses[verses.length - 1].verse}`;
    } else {
      result.verses = allVerses;
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error) {
    throw new Error(`Error fetching scripture: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function searchScriptures(args: any) {
  const { query, collection, language = 'eng' } = args;
  
  let searchUrl = `https://www.churchofjesuschrist.org/search?facet=scriptures&lang=${language}&page=1&query=${encodeURIComponent(query)}&type=web`;
  if (collection) {
    const collectionCode = SCRIPTURE_COLLECTIONS[collection as keyof typeof SCRIPTURE_COLLECTIONS];
    if (collectionCode) {
      searchUrl += `&collections=${collectionCode}`;
    }
  }

  try {
    const response = await fetch(searchUrl);
    if (!response.ok) {
      throw new Error(`Search failed: ${response.status} ${response.statusText}`);
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    const results: any[] = [];
    $('.search-result').each((_, element) => {
      const title = $(element).find('.result-title').text().trim();
      const snippet = $(element).find('.result-snippet').text().trim();
      const link = $(element).find('a').attr('href');
      
      if (title && snippet) {
        results.push({
          title,
          snippet,
          url: link ? `https://www.churchofjesuschrist.org${link}` : null
        });
      }
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query,
            language,
            collection: collection || 'all',
            results,
            total: results.length
          }, null, 2)
        }
      ]
    };
  } catch (error) {
    throw new Error(`Error searching scriptures: ${error instanceof Error ? error.message : String(error)}`);
  }
}


async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
  });
}