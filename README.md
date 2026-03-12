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

**What makes a good description?** Be specific about what you want. Include domain-relevant details. Think about describing the *end result* you want to see, not implementation details. The language-specific AI understands domain terminology.

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

## Language Guide: L0169 — Concept Web Assessments

L0169 creates **interactive concept web assessment diagrams** — educational tools where students engage with interconnected concept nodes arranged in a radial layout around a central hub. Students demonstrate understanding by dragging concepts from a tray into the correct positions on the web.

### What You Can Create

- Concept webs with a central topic and radiating connected concepts
- Drag-and-drop assessments where learners place concepts correctly
- Themed interfaces (light or dark)
- Image-augmented concepts with visual resources
- Configurable concept tray positions (right, left, top, bottom)
- Self-grading assessments that check learner responses

### Creating a Concept Web Assessment

To create a concept web assessment, call `create_item` with `language: "L0169"` and describe your assessment in natural language:

```
create_item(
  language: "L0169",
  description: "Create a concept web assessment about photosynthesis.
    The central concept is 'Light Reactions'. Connected concepts are
    'Calvin Cycle', 'Chlorophyll', 'ATP Production', and 'Water Splitting'.
    Each concept should be assessed by matching its label. Use a dark theme
    with the concept tray on the right side."
)
```

The L0169 backend understands educational assessment terminology. Here are more examples of effective descriptions:

**A simple concept web:**

```
create_item(
  language: "L0169",
  description: "Create a concept web about the water cycle. The central
    concept is Evaporation. Connected concepts: Condensation, Precipitation,
    Collection, and Transpiration."
)
```

**A complex assessment with images:**

```
create_item(
  language: "L0169",
  description: "Create a concept web assessment about the solar system.
    The Sun is the central concept. Connected concepts are Mercury, Venus,
    Earth, Mars, Jupiter, Saturn, Uranus, and Neptune. Add a planet image
    to each concept. Assess each concept by matching its name. Place the
    concept tray at the bottom and use a light theme."
)
```

**An assessment for younger learners:**

```
create_item(
  language: "L0169",
  description: "Create a concept web for elementary students about
    animal classification. The central concept is 'Animals'. Connected
    concepts are 'Mammals', 'Birds', 'Fish', 'Reptiles', and 'Amphibians'.
    Keep it simple with no assessment — just the web structure."
)
```

### Modifying a Concept Web

Use `update_item` to refine your assessment iteratively. You don't need to redescribe the entire web — just say what you want to change:

**Adding concepts:**

```
update_item(
  item_id: "abc123",
  modification: "Add a new connected concept called 'Carbon Fixation'
    between Calvin Cycle and ATP Production."
)
```

**Changing the theme:**

```
update_item(
  item_id: "abc123",
  modification: "Switch to a light theme and move the concept tray
    to the bottom."
)
```

**Adjusting assessment configuration:**

```
update_item(
  item_id: "abc123",
  modification: "Remove the assessment from the central concept but
    keep it on all the connected concepts."
)
```

### What L0169 Can Express

L0169 has 14 core operations that cover the full domain of concept web assessments:

| Capability | What It Means |
|---|---|
| **Topic labeling** | Give the overall concept web a title or subject label |
| **Central concept (anchor)** | Define the hub node that all other concepts radiate from |
| **Connected concepts** | Add peripheral nodes that connect to the central concept with auto-generated edges |
| **Assessment configuration** | Attach evaluation parameters to any concept node specifying what constitutes a correct response |
| **Assessment methods** | Define how responses are evaluated (e.g., by matching a value) |
| **Concept tray** | A draggable tray of concept labels that learners place onto the web |
| **Tray alignment** | Position the tray on any side: right, left, top, or bottom |
| **Image attachment** | Add visual resources (images) to any concept node |
| **Theming** | Switch between light and dark interface themes |

### What L0169 Cannot Express

L0169 is specialized for radial concept webs. It does not support free-form quizzes, multiple-choice questions, text-input fields, hierarchical trees, or linear sequences. For tabular data and spreadsheets, use L0166. For flashcards and matching games, use L0159.

---

## Language Guide: L0166 — Spreadsheets and Tabular Data

L0166 creates **interactive spreadsheets** with formatted cells, formulas, and structured tabular data.

### Creating a Spreadsheet

```
create_item(
  language: "L0166",
  description: "Create a spreadsheet with two columns: Term and Definition.
    Add three rows: Photosynthesis / The process by which plants convert
    sunlight to energy, Mitosis / Cell division producing two identical
    cells, Osmosis / Movement of water across a semipermeable membrane.
    Make the header row bold with a light blue background."
)
```

### Modifying a Spreadsheet

```
update_item(
  item_id: "xyz789",
  modification: "Add a fourth row: Homeostasis / The body's ability to
    maintain a stable internal environment. Make the header background
    color light green instead of light blue."
)
```

---

## Language Guide: L0159 — Flashcards, Match, and Memory Games

L0159 creates **interactive flashcard sets** and card-matching games for learning and review.

### Creating Flashcards

```
create_item(
  language: "L0159",
  description: "Create a set of flashcards for Spanish vocabulary.
    Include: House / Casa, Dog / Perro, Cat / Gato, Book / Libro,
    Water / Agua. The front of each card shows the English word and
    the back shows the Spanish translation."
)
```

---

## Rendering Items in Your Application

Every Graffiticode language has a corresponding React component published on npm. When you call `create_item`, `update_item`, or `get_item`, the response includes a `react_usage` field with everything you need to embed the item in a React application.

### Installation

Each language has its own npm package following the pattern `@graffiticode/<language-id>`:

```bash
npm install @graffiticode/l0169  # for concept web assessments
npm install @graffiticode/l0166  # for spreadsheets
npm install @graffiticode/l0159  # for flashcards
```

### Usage Pattern (Universal)

The pattern is the same for every language. Use the `data` field from the MCP response to hydrate the component:

```jsx
import React from 'react';
import { Form } from '@graffiticode/l0169';
import '@graffiticode/l0169/style.css';

function createState(initialData) {
  let data = initialData;
  return {
    get data() { return data; },
    apply(action) {
      if (action.args) {
        data = { ...data, ...action.args };
      }
    }
  };
}

function ConceptWebAssessment({ itemData }) {
  // itemData is the COMPLETE 'data' field from create_item / update_item / get_item
  const [state] = React.useState(() => createState(itemData));
  return <Form state={state} />;
}
```

The `state.data` object must be the complete `data` field from the API response, including its `validation.regions` structure. Pass the whole object — don't extract subsets.

### Interactive Widgets

When using the MCP server with Claude or ChatGPT, items render automatically as interactive widgets directly in the chat interface. No additional setup is needed — the server provides widget resources that these platforms use to display your items inline.

### Troubleshooting

| Issue | Solution |
|---|---|
| Multiple React versions error | Add `resolve.dedupe: ['react', 'react-dom']` to your Vite/webpack config |
| Cannot read 'regions' of null | Pass the complete `data` object from the API response, not a subset |
| CSS not loading | Import styles from `@graffiticode/<lang>/style.css` |

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

## Source Code

The MCP server is open source under the MIT license:

- **Repository:** [github.com/graffiticode/graffiticode-mcp-server](https://github.com/graffiticode/graffiticode-mcp-server)
- **L0169 Language:** [github.com/graffiticode/l0169](https://github.com/graffiticode/l0169)
- **L0169 Specification:** [l0169.graffiticode.org/spec.html](https://l0169.graffiticode.org/spec.html)

All Graffiticode languages are accessed through the natural language interface provided by this MCP server or the Graffiticode console at [console.graffiticode.org](https://console.graffiticode.org). Direct code authoring is neither required nor recommended.
