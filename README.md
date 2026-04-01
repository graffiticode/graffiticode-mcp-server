# Graffiticode MCP Server Documentation

The Graffiticode MCP server connects AI assistants and applications to a growing catalog of domain-specific tools. Each tool is powered by a Graffiticode language — a specialized DSL optimized for a particular task domain. You interact with these languages entirely through natural language: describe what you want to create, and a language-specific AI generates the result.

You never need to learn or write DSL code. The MCP server is the interface.

---

## How It Works

The Graffiticode MCP server is a **thin router**. It exposes five language-agnostic tools that route your natural language requests to language-specific backends. Each backend has deep knowledge of its language's domain and translates your descriptions into working programs.

```
┌──────────────────────────────────────────────────────────┐
│  Your AI Assistant (Claude, ChatGPT, or any MCP client)  │
│  "Create a concept web assessment about photosynthesis"  │
└──────────────────────────┬───────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│  Graffiticode MCP Server (thin router)                   │
│  Tools: create_item, update_item, get_item,              │
│         list_languages, get_language_info                 │
└──────────────────────────┬───────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│  Graffiticode API → Language-specific AI backends        │
│  L0169 backend: concept web assessments                  │
│  L0166 backend: spreadsheets and tabular data            │
│  L0159 backend: flashcards and matching games            │
│  ...and more via list_languages                          │
└──────────────────────────────────────────────────────────┘
```

The workflow is always the same regardless of language:

1. **Discover** — Call `list_languages` to see what's available.
2. **Create** — Call `create_item` with a language ID and a natural language description.
3. **Iterate** — Call `update_item` with a natural language description of what to change.
4. **Retrieve** — Call `get_item` to fetch an existing item by ID.
5. **Learn more** — Call `get_language_info` for details about a specific language.

---

## Connecting to the Server

The MCP server supports two transport modes: a hosted HTTP endpoint for cloud deployments and agent platforms, and a stdio transport for local CLI usage.

### Hosted Server (Recommended)

The hosted Graffiticode MCP server is available at:

```
https://mcp.graffiticode.org/mcp
```

#### Claude Desktop

Add via **Settings → Connectors** with the URL `https://mcp.graffiticode.org/mcp`. OAuth authentication is handled automatically.

#### Claude Code

```json
{
  "mcpServers": {
    "graffiticode": {
      "url": "https://mcp.graffiticode.org/mcp",
      "headers": {
        "Authorization": "Bearer <your-api-key>"
      }
    }
  }
}
```

#### ChatGPT and Other MCP Clients

Any MCP-compatible client can connect using Streamable HTTP transport at the `/mcp` endpoint. Authentication is via Bearer token in the `Authorization` header — either an OAuth access token or a Graffiticode API key.

### Local Server (Stdio)

For local development or CLI usage:

```bash
npm install graffiticode-mcp-server
GC_API_KEY_SECRET=your-api-key npx graffiticode-mcp
```

Or clone and build from source:

```bash
git clone https://github.com/graffiticode/graffiticode-mcp-server.git
cd graffiticode-mcp-server
npm install && npm run build
GC_API_KEY_SECRET=your-api-key npm start
```

### Authentication

The server supports two authentication methods:

- **OAuth 2.1** (recommended for interactive clients) — The server implements OAuth 2.1 with PKCE. Clients that support MCP OAuth discovery will be guided through the flow automatically.
- **API Key** (for programmatic access) — Pass your Graffiticode API key as a Bearer token: `Authorization: Bearer gc_xxxxx`

---

## Tools Reference

### list_languages

Discover what Graffiticode languages are available.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `category` | string | No | Filter by category (e.g., "data", "general") |
| `search` | string | No | Search by keyword |

**Example — discovering all languages:**

```
list_languages()
```

Returns:

```json
{
  "languages": [
    {
      "id": "L0002",
      "name": "L0002",
      "description": "Simple programs with text rendering and theming",
      "category": "general"
    },
    {
      "id": "L0159",
      "name": "L0159",
      "description": "Flashcards, Match and Memory card games",
      "category": "data"
    },
    {
      "id": "L0166",
      "name": "L0166",
      "description": "Spreadsheets and tabular data with formulas",
      "category": "data"
    },
    {
      "id": "L0169",
      "name": "L0169",
      "description": "Interactive concept web assessment diagrams",
      "category": "data"
    }
  ]
}
```

**Example — searching for assessment-related languages:**

```
list_languages(search: "assessment")
```

---

### get_language_info

Get detailed information about a specific language, including its spec URL and React component for embedding.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `language` | string | Yes | Language ID (e.g., "L0169") |

**Example:**

```
get_language_info(language: "L0169")
```

Returns the language's description, category, specification URL, and instructions for rendering items using the language's React component.

---

### create_item

Create a new item in any Graffiticode language. Describe what you want in natural language — the language-specific AI backend handles everything else.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `language` | string | Yes | Language ID (e.g., "L0169"). Use `list_languages` to discover options. |
| `description` | string | Yes | Natural language description of what to create. |
| `name` | string | No | A friendly name for the item. |

**Returns:** An object containing `item_id` (for subsequent calls), `task_id`, `language`, `data` (the compiled output), and `react_usage` (instructions for rendering).

**What makes a good description?** Be specific about what you want. Include domain-relevant details. Describe the *end result* you want to see, not implementation details. The language-specific AI understands domain terminology. Call `get_language_info` for guidance on what a particular language can do.

---

### update_item

Modify an existing item by describing what you want to change. The language is auto-detected from the item — you don't need to specify it again.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `item_id` | string | Yes | The item ID from a previous `create_item` or `get_item` call. |
| `modification` | string | Yes | Natural language description of what to change. |

**Returns:** The same structure as `create_item`, with the updated data.

The server maintains conversation history for each item, so the language-specific AI has context from previous interactions. You can make incremental changes naturally: "add another concept," "change the theme to dark," "make the header row blue."

---

### get_item

Retrieve an existing item by its ID.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `item_id` | string | Yes | The item ID to retrieve. |

**Returns:** The item's data, code, metadata, timestamps, and React rendering instructions.

---

## Available Languages

The language catalog is dynamic — call `list_languages` to discover what's currently available, and `get_language_info` for details on any specific language. Each language has its own specification page, source repository, and usage documentation.

| Language | Description | Spec | Repository |
|---|---|---|---|
| L0002 | Simple programs with text rendering and theming | [spec](https://l0002.graffiticode.org/spec.html) | [github](https://github.com/graffiticode/l0002) |
| L0159 | Flashcards, Match, and Memory card games | [spec](https://l0159.graffiticode.org/spec.html) | [github](https://github.com/graffiticode/l0159) |
| L0166 | Spreadsheets and tabular data with formulas | [spec](https://l0166.graffiticode.org/spec.html) | [github](https://github.com/graffiticode/l0166) |
| L0169 | Interactive concept web assessment diagrams | [spec](https://l0169.graffiticode.org/spec.html) | [github](https://github.com/graffiticode/l0169) |

For language-specific capabilities, natural language prompting tips, and domain documentation, see the individual language spec pages linked above.

---

## Rendering Items in Your Application

Every Graffiticode language has a corresponding React component published on npm as `@graffiticode/<language-id>`. When you call `create_item`, `update_item`, or `get_item`, the response includes a `react_usage` field with installation instructions, a code example, and troubleshooting tips specific to that language.

When using the MCP server with Claude or ChatGPT, items render automatically as interactive widgets directly in the chat interface — no additional setup needed.

---

## Conversation History and Context

The MCP server maintains conversation history for each item. When you call `update_item`, the server passes context from previous interactions to the language-specific AI, so it understands what you've already created and can make precise modifications.

This means you can work iteratively in a natural conversational style:

1. "Create a concept web about the water cycle with Evaporation at the center"
2. "Add Runoff as a connected concept"
3. "Make it use a dark theme"
4. "Add assessment to all the connected concepts"

Each step builds on the previous ones. The language AI remembers the full history.

---

## Environment Variables

For self-hosted deployments:

| Variable | Required | Default | Description |
|---|---|---|---|
| `GC_API_KEY_SECRET` | Yes (stdio) | — | Graffiticode API key for stdio transport |
| `GRAFFITICODE_CONSOLE_URL` | No | `https://graffiticode.org/api` | API endpoint |
| `GRAFFITICODE_AUTH_URL` | No | `https://auth.graffiticode.org` | Auth endpoint |
| `PORT` | No | `3001` | HTTP server port (hosted mode) |
| `MCP_SERVER_URL` | No | `https://mcp.graffiticode.org` | Public URL for OAuth metadata |

---

## Support

- **Email:** [support@graffiticode.org](mailto:support@graffiticode.org)
- **Community:** [forum.graffiticode.org](https://forum.graffiticode.org)
- **Bug reports:** [GitHub Issues](https://github.com/graffiticode/graffiticode-mcp-server/issues)
- **Privacy policy:** [mcp.graffiticode.org/privacy](https://mcp.graffiticode.org/privacy)
- **Terms of service:** [mcp.graffiticode.org/terms](https://mcp.graffiticode.org/terms)

---

## Source Code

The MCP server is open source under the MIT license:

- **Repository:** [github.com/graffiticode/graffiticode-mcp-server](https://github.com/graffiticode/graffiticode-mcp-server)
- **L0169 Language:** [github.com/graffiticode/l0169](https://github.com/graffiticode/l0169)
- **L0169 Specification:** [l0169.graffiticode.org/spec.html](https://l0169.graffiticode.org/spec.html)

All Graffiticode languages are accessed through the natural language interface provided by this MCP server or the Graffiticode console at [console.graffiticode.org](https://console.graffiticode.org). Direct code authoring is neither required nor recommended.
