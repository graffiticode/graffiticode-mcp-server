# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm run build      # Compile TypeScript to dist/
npm run clean      # Remove dist/ directory
npm run start      # Run stdio MCP server (requires GRAFFITICODE_API_KEY env var)
npm run start:hosted  # Run Streamable HTTP hosted server (reads PORT env, defaults to 3001)
npm run gcp:build  # Deploy to Google Cloud Run via Cloud Build
npm run gcp:logs   # View Cloud Run logs
```

## Architecture

This is a thin-router MCP server for Graffiticode. It provides a fixed set of language-agnostic tools that route to language-specific backends. The client specifies which language to use; all language expertise lives in the backend.

```
┌─────────────────────────────────────────────────────────────────────┐
│  MCP Server (thin router)                                           │
│  Tools: create_item, update_item, get_item, list_languages,        │
│         get_language_info                                           │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Graffiticode API → Language-specific backends                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Entry Points

- **`src/index.ts`** - Stdio transport for local CLI usage. Requires `GRAFFITICODE_API_KEY` env var.
- **`src/server.ts`** - Streamable HTTP transport for hosted deployments. Auth via `Authorization: Bearer <api-key>` header. Endpoint: `/mcp`

### Core Modules

- **`src/auth.ts`** - Firebase auth: API key → custom token → ID token. Tokens cached 55 min.
- **`src/api.ts`** - GraphQL client for Graffiticode API. All language discovery and code generation is backend-driven.
- **`src/tools.ts`** - MCP tool definitions and handlers. Routes requests to backend based on language parameter.

### MCP Tools (fixed set, language-agnostic)

| Tool | Purpose |
|------|---------|
| `create_item(language, description)` | Create item in any language |
| `update_item(item_id, modification)` | Update item (language auto-detected) |
| `get_item(item_id)` | Retrieve item by ID |
| `list_languages(category?, search?)` | Discover available languages |
| `get_language_info(language)` | Get language docs, examples, React usage |

### Environment Variables

- `GC_API_KEY_SECRET` - Required for stdio server
- `GRAFFITICODE_CONSOLE_URL` - API endpoint (default: `https://graffiticode.org/api`)
- `GRAFFITICODE_AUTH_URL` - Auth endpoint (default: `https://auth.graffiticode.org`)
- `PORT` - HTTP server port (default: 3001)
