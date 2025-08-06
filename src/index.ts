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

const SCRIPTURE_COLLECTIONS = {
  'old-testament': 'ot',
  'new-testament': 'nt', 
  'book-of-mormon': 'bofm',
  'doctrine-and-covenants': 'dc-testament',
  'pearl-of-great-price': 'pgp'
};

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_scripture',
        description: 'Get scripture text from Gospel Library by reference (book, chapter, verse)',
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
              description: 'Book abbreviation or name (e.g., "1-ne", "alma", "matt", "gen")'
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
      },
      {
        name: 'list_books',
        description: 'List available books in a scripture collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection: {
              type: 'string',
              enum: Object.keys(SCRIPTURE_COLLECTIONS),
              description: 'Scripture collection to list books for'
            },
            language: {
              type: 'string',
              description: 'Language code (default: eng)',
              default: 'eng',
              optional: true
            }
          },
          required: ['collection']
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
    case 'list_books':
      return await listBooks(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function getScripture(args: any) {
  const { collection, book, chapter, verse, language = 'eng' } = args;
  
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
    
    let result: any = {
      reference: `${collection} ${book} ${chapter}${verse ? ':' + verse : ''}`,
      url: url,
      language: language
    };

    if (verse) {
      const verseElement = $(`#p${verse}`);
      if (verseElement.length === 0) {
        throw new Error(`Verse ${verse} not found in ${collection} ${book} ${chapter}`);
      }
      result.text = verseElement.text().trim();
      result.verse = verse;
    } else {
      const verses: any[] = [];
      $('.verse').each((_, element) => {
        const verseNum = $(element).attr('data-aid')?.match(/p(\d+)/)?.[1];
        const text = $(element).text().trim();
        if (verseNum && text) {
          verses.push({
            verse: parseInt(verseNum),
            text: text
          });
        }
      });
      result.verses = verses;
      result.chapterTitle = $('h1').first().text().trim();
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

async function listBooks(args: any) {
  const { collection, language = 'eng' } = args;
  
  const collectionCode = SCRIPTURE_COLLECTIONS[collection as keyof typeof SCRIPTURE_COLLECTIONS];
  if (!collectionCode) {
    throw new Error(`Invalid collection: ${collection}`);
  }

  const url = `${BASE_URL}/scriptures/${collectionCode}?lang=${language}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch collection: ${response.status} ${response.statusText}`);
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    const books: any[] = [];
    $(`a[href*="/study/scriptures/${collectionCode}/"]`).each((_, element) => {
      const title = $(element).text().trim();
      const href = $(element).attr('href');
      
      if (title && href && href.includes(`/scriptures/${collectionCode}/`)) {
        const bookCode = href.split('/').pop()?.split('?')[0];
        // Only include main book links, not chapter links
        if (bookCode && bookCode !== collectionCode && !href.includes(`/${collectionCode}/${bookCode}/`)) {
          books.push({
            title,
            code: bookCode,
            url: `https://www.churchofjesuschrist.org${href}`
          });
        }
      }
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            collection,
            language,
            books,
            total: books.length
          }, null, 2)
        }
      ]
    };
  } catch (error) {
    throw new Error(`Error listing books: ${error instanceof Error ? error.message : String(error)}`);
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