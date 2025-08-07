# Unofficial Gospel Library MCP Server

An MCP (Model Context Protocol) server for accessing scriptures from the Gospel Library of The Church of Jesus Christ of Latter-day Saints.

## Features

- **Get Scripture Text**: Retrieve specific verses or entire chapters from any book of scripture.
- **Get Book Info**: Get information about a book of scripture, including the number of chapters and verses in each chapter.

## Installation

```bash
bun install
bun run build
```

## Usage

The server provides two main tools:

### 1. get_book_info
Get information about a book of scripture:

```json
{
  "collection": "book-of-mormon",
  "book": "1 Nephi"
}
```

### 2. get_scripture_text
Retrieve scripture text by reference:

```json
{
  "collection": "book-of-mormon",
  "book": "1 Nephi",
  "chapter": 3,
  "verse": 7
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

- This server uses JSON data from the [scriptures-json](https://github.com/bcbooks/scriptures-json) repository.
