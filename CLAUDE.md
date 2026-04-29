# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm run build         # Compile TypeScript to dist/
npm run clean         # Remove dist/ directory
npm run start         # Run Streamable HTTP server (reads PORT env, defaults to 3001)
npm run gcp:build     # Deploy to Google Cloud Run via Cloud Build
npm run gcp:deploy    # Deploy from source to Cloud Run (mcp-service, us-central1)
npm run gcp:logs      # View Cloud Run logs
```

No test suite is configured.

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

- **`src/server.ts`** - Streamable HTTP transport for hosted deployments. Auth via `Authorization: Bearer <api-key>` header, OAuth 2.1 access token, or no auth at all (free-plan path: server forwards calls to console with `X-Free-Plan-Session: <mcp-session-id>` instead). Endpoint: `/mcp`

### Core Modules

- **`src/auth.ts`** - Firebase auth: API key → custom token → ID token. Tokens cached 55 min.
- **`src/api.ts`** - GraphQL client for Graffiticode API. All language discovery and code generation is backend-driven.
- **`src/tools.ts`** - MCP tool definitions and handlers. Routes requests to backend based on language parameter.
- **`src/oauth/`** - OAuth 2.1 + PKCE for hosted mode: dynamic client registration, authorize/callback/token endpoints, Firestore-backed store. Hosted auth accepts either an OAuth access token or a raw Graffiticode API key as the Bearer credential.
- **`src/widget/`** - HTML widgets exposed as MCP resources and wired into tool responses via `_meta` (`openai/outputTemplate` for ChatGPT Apps, `ui.resourceUri` for Claude MCP Apps) so items render inline in chat clients.

### Implementation notes

- **Conversation history.** `update_item` reads the item's `help` field (JSON array of prior user messages), builds a contextual prompt from the last 6 entries plus current `src`, calls `generateCode`, then appends a new entry and writes the updated array back. Iterative edits depend on this round-trip — don't drop the `help` write.
- **Language ID normalization.** Clients may pass `L0166` or `0166`; handlers strip the leading `L` before calling the API, and responses re-add it.
- **`create_item` flow.** Creates an empty item from the language template, then delegates to `handleUpdateItem` with the user's description — so template seeding and first-turn generation share one code path.

### MCP Tools (fixed set, language-agnostic)

| Tool | Purpose |
|------|---------|
| `create_item(language, description)` | Create item in any language |
| `update_item(item_id, modification)` | Update item (language auto-detected) |
| `get_item(item_id)` | Retrieve item by ID |
| `list_languages(category?, search?)` | Discover available languages |
| `get_language_info(language)` | Get language docs, examples, React usage |

### Environment Variables

- `GRAFFITICODE_CONSOLE_URL` - API endpoint (default: `https://console.graffiticode.org/api`)
- `GRAFFITICODE_AUTH_URL` - Auth endpoint (default: `https://auth.graffiticode.org`)
- `PORT` - HTTP server port (default: 3001)
