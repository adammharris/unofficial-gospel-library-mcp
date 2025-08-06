# Unofficial Gospel Library MCP Server

An MCP (Model Context Protocol) server for accessing scriptures and resources from the Gospel Library of The Church of Jesus Christ of Latter-day Saints.

## Features

- **Get Scripture**: Retrieve specific verses or entire chapters from any scripture collection
- **Search Scriptures**: Search for text within Gospel Library scriptures  
- **List Books**: Get a list of available books in any scripture collection
- **Multi-language Support**: Access scriptures in different languages (default: English)

## Installation

```bash
bun install
bun run build
```

## Usage

The server provides three main tools:

### 1. get_scripture
Retrieve scripture text by reference:

```json
{
  "collection": "book-of-mormon",
  "book": "1-ne",
  "chapter": 3,
  "verse": 7,
  "language": "eng"
}
```

### 2. search_scriptures
Search for text within scriptures:

```json
{
  "query": "faith hope charity",
  "collection": "book-of-mormon",
  "language": "eng"
}
```

### 3. list_books
List available books in a collection:

```json
{
  "collection": "new-testament",
  "language": "eng"
}
```

## Scripture Collections

- `old-testament`
- `new-testament`
- `book-of-mormon`
- `doctrine-and-covenants`
- `pearl-of-great-price`

## Running the Server

```bash
bun run start
```

## Configuration for MCP Clients

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "gospel-library": {
      "command": "node",
      "args": ["/path/to/unofficial-gospel-library-mcp/dist/index.js"],
      "env": {}
    }
  }
}
```

## Notes

- This is an unofficial implementation that scrapes content from the public Gospel Library website
- Respects the Church's terms of service for educational and personal use
- Language codes follow ISO 639-3 standard (e.g., "eng", "spa", "por")