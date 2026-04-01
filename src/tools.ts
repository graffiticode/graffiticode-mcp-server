import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  generateCode,
  getData,
  createItem as apiCreateItem,
  getItem as apiGetItem,
  updateItem as apiUpdateItem,
  listLanguages as apiListLanguages,
  getLanguageInfo as apiGetLanguageInfo,
  getTemplate,
} from "./api.js";
import { WIDGET_RESOURCE_URI, WIDGET_CSP, CLAUDE_WIDGET_RESOURCE_URI } from "./widget/index.js";

// --- Help Entry Structure (matches console HelpPanel) ---

interface HelpEntry {
  user: string;
  help: { type?: "code"; text: string };
  type: "user";
  timestamp: string;
  taskId?: string;
}

function parseHelp(helpJson: string | null): HelpEntry[] {
  if (!helpJson) return [];
  try {
    return JSON.parse(helpJson);
  } catch {
    return [];
  }
}

function buildContextualPrompt(
  help: HelpEntry[],
  newMessage: string,
  currentCode: string
): string {
  // If no meaningful history, just return the new message
  if (help.length < 1) return newMessage;

  let context = "Previous conversation:\n\n";
  const limitedHistory = help.slice(-6); // Last 6 messages (3 exchanges)

  for (const item of limitedHistory) {
    context += `User: ${item.user}\n`;
    if (item.taskId) {
      context += `Assistant: [Generated Graffiticode code]\n`;
    }
  }

  if (currentCode?.trim()) {
    context += "\nAssistant's latest generated code:\n```\n" + currentCode + "\n```\n";
  }

  context += "\nNow, please address this new request:\n";
  return context + newMessage;
}

// --- Server Instructions (sent to agents at connection time) ---

export const SERVER_INSTRUCTIONS = `Graffiticode is an open-ended platform of domain-specific tools for creating interactive content — assessments, spreadsheets, flashcards, and more. The catalog of available tools grows over time.

When the user's request doesn't match another available tool, call list_languages() to check if Graffiticode has a language that fits. Use the search parameter to match by keyword. If a match exists, call get_language_info() to learn what the language can create and get its usage guide URL, then call create_item() with a natural language description.

All requests to create_item and update_item must be natural language descriptions of what to create or change. A language-specific AI backend handles all code generation. Do not attempt to generate Graffiticode DSL code directly.

Workflow: list_languages(search) → get_language_info(language) → create_item(language, description) → update_item(item_id, modification) to iterate.`;

// --- Tool Definitions ---

export const createItemTool = {
  name: "create_item",
  description: `Create interactive content in any Graffiticode language. Describe what you want in natural language — a language-specific AI generates the result.

Call list_languages() first to discover available languages, then pass the language ID here. The description should be a natural language request, not code. Be specific about the content, structure, layout, theme, and any assessment or interaction requirements.

Returns item_id for use in subsequent update_item or get_item calls.`,
  inputSchema: {
    type: "object",
    properties: {
      language: {
        type: "string",
        description: "Language ID (e.g., 'L0166'). Call list_languages() to discover options.",
      },
      description: {
        type: "string",
        description: "Natural language description of what to create. Be specific about content, structure, and visual preferences.",
      },
      name: {
        type: "string",
        description: "Optional friendly name for the item",
      },
    },
    required: ["language", "description"],
  },
  annotations: {
    title: "Create Item",
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  _meta: {
    // ChatGPT Apps metadata
    "openai/outputTemplate": WIDGET_RESOURCE_URI,
    "openai/widgetCSP": WIDGET_CSP,
    // Claude MCP Apps metadata
    ui: { resourceUri: CLAUDE_WIDGET_RESOURCE_URI },
  },
} as const;

export const updateItemTool = {
  name: "update_item",
  description: `Modify an existing Graffiticode item by describing what to change in natural language.

The language is auto-detected from the item. Conversation history is preserved, so you can make incremental changes: "add another concept", "change the theme to dark", "make the header row blue".`,
  inputSchema: {
    type: "object",
    properties: {
      item_id: {
        type: "string",
        description: "The item ID from a previous create_item call",
      },
      modification: {
        type: "string",
        description: "Natural language description of what to change",
      },
    },
    required: ["item_id", "modification"],
  },
  annotations: {
    title: "Update Item",
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  _meta: {
    // ChatGPT Apps metadata
    "openai/outputTemplate": WIDGET_RESOURCE_URI,
    "openai/widgetCSP": WIDGET_CSP,
    // Claude MCP Apps metadata
    ui: { resourceUri: CLAUDE_WIDGET_RESOURCE_URI },
  },
} as const;

export const getItemTool = {
  name: "get_item",
  description: `Get an existing Graffiticode item by ID.

Returns the item's data, code, and metadata.`,
  inputSchema: {
    type: "object",
    properties: {
      item_id: {
        type: "string",
        description: "The item ID to retrieve",
      },
    },
    required: ["item_id"],
  },
  annotations: {
    title: "Get Item",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  _meta: {
    // ChatGPT Apps metadata
    "openai/outputTemplate": WIDGET_RESOURCE_URI,
    "openai/widgetCSP": WIDGET_CSP,
    // Claude MCP Apps metadata
    ui: { resourceUri: CLAUDE_WIDGET_RESOURCE_URI },
  },
} as const;

export const listLanguagesTool = {
  name: "list_languages",
  description: `Discover available Graffiticode languages. Use this to find a language that matches the user's needs.

The catalog is dynamic and grows over time. Use the search parameter to match by keyword (e.g., "spreadsheet", "assessment", "flashcard"). Returns language IDs, names, descriptions, and categories.`,
  inputSchema: {
    type: "object",
    properties: {
      category: {
        type: "string",
        description: "Filter by category (e.g., 'data', 'general')",
      },
      search: {
        type: "string",
        description: "Search by keyword (e.g., 'assessment', 'spreadsheet', 'flashcard')",
      },
    },
  },
  annotations: {
    title: "List Languages",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
} as const;

export const getLanguageInfoTool = {
  name: "get_language_info",
  description: `Get detailed information about a Graffiticode language, including what it can create and how to use it.

Returns name, description, category, usage guide URL (what you can ask for in natural language), spec URL (full vocabulary reference), and React component instructions for embedding.

Call this after list_languages() to learn about a specific language before using create_item().`,
  inputSchema: {
    type: "object",
    properties: {
      language: {
        type: "string",
        description: "Language ID (e.g., 'L0166')",
      },
    },
    required: ["language"],
  },
  annotations: {
    title: "Get Language Info",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
} as const;

// Export all tools as array (cast to allow _meta extension for ChatGPT Apps SDK)
export const tools = [
  createItemTool,
  updateItemTool,
  getItemTool,
  listLanguagesTool,
  getLanguageInfoTool,
] as unknown as Tool[];

// --- React Usage Instructions (universal for all Graffiticode languages) ---

function getReactUsage(langId: string) {
  const packageName = `@graffiticode/l${langId}`;

  return {
    npm_package: packageName,
    peer_dependencies: {
      react: "^17.0.0 || ^18.0.0 || ^19.0.0",
      "react-dom": "^17.0.0 || ^18.0.0 || ^19.0.0",
    },
    usage: `The Form component expects a state object with:
- state.data: The COMPLETE data object from create_item/get_item (must include validation.regions)
- state.apply(action): Method for state transitions

IMPORTANT: Pass the complete 'data' object - the Form requires validation.regions to render.

Create a state object like this:
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

Then pass it to the Form component:
  <Form state={createState(itemData)} />`,
    example: `import React from 'react';
import { Form } from '${packageName}';
import '${packageName}/style.css';

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

function App({ itemData }) {
  // itemData is the COMPLETE 'data' field from create_item, update_item, or get_item
  // It must include: title, instructions, validation (with regions), and interaction
  const [state] = React.useState(() => createState(itemData));
  return <Form state={state} />;
}`,
    vite_config: `// vite.config.js - Add resolve.dedupe if you encounter React version conflicts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom']
  }
});`,
    troubleshooting: {
      "Multiple React versions error": "Add resolve.dedupe: ['react', 'react-dom'] to your Vite/webpack config",
      "Cannot read 'regions' of null": "Pass the complete 'data' object from the API response, not a subset",
      "CSS not loading": `Import styles from '${packageName}/style.css' (not /dist/style.css)`,
    },
  };
}

// --- Tool Handlers ---

export interface ToolContext {
  token: string;
}

export async function handleCreateItem(
  ctx: ToolContext,
  args: { language: string; description: string; name?: string }
): Promise<unknown> {
  const { language, description, name } = args;

  // Normalize language ID (remove "L" prefix if present)
  const langId = language.replace(/^L/i, "");

  // Step 1: Fetch template for the language
  const template = await getTemplate(langId);

  // Step 2: Generate code from description (routes to language-specific backend)
  const generated = await generateCode({
    token: ctx.token,
    prompt: description,
    language: langId,
    currentCode: template || undefined,
  });

  if (!generated.taskId) {
    throw new Error("No taskId returned from code generation");
  }

  // Step 3: Get compiled data
  const data = await getData({
    token: ctx.token,
    taskId: generated.taskId,
  });

  // Step 4: Build help array with initial entry
  const helpEntry: HelpEntry = {
    user: description,
    help: { text: description },
    type: "user",
    timestamp: new Date().toISOString(),
    taskId: generated.taskId,
  };
  const help = JSON.stringify([helpEntry]);

  // Step 5: Create item with help context
  const item = await apiCreateItem({
    token: ctx.token,
    lang: langId,
    name,
    taskId: generated.taskId,
    code: generated.code,
    help,
    app: "mcp",
  });

  return {
    item_id: item.id,
    task_id: generated.taskId,
    language: `L${langId}`,
    name: item.name,
    description: generated.description,
    code: generated.code,
    data,
    usage: generated.usage,
    hint: "Call get_language_info() for React component usage and embedding instructions.",
    // Widget-only data (not exposed to model)
    _meta: {
      access_token: ctx.token,
    },
  };
}

export async function handleUpdateItem(
  ctx: ToolContext,
  args: { item_id: string; modification: string }
): Promise<unknown> {
  const { item_id, modification } = args;

  // Step 1: Get existing item to find language, current code, and help history
  const existingItem = await apiGetItem({
    token: ctx.token,
    id: item_id,
  });

  if (!existingItem) {
    throw new Error(`Item not found: ${item_id}`);
  }

  // Step 2: Parse existing help history and build contextual prompt
  const existingHelp = parseHelp(existingItem.help);
  const contextualPrompt = buildContextualPrompt(
    existingHelp,
    modification,
    existingItem.code
  );

  // Step 3: Generate updated code with contextual prompt
  const generated = await generateCode({
    token: ctx.token,
    prompt: contextualPrompt,
    language: existingItem.lang,
    currentCode: existingItem.code,
  });

  if (!generated.taskId) {
    throw new Error("No taskId returned from code generation");
  }

  // Step 4: Get compiled data
  const data = await getData({
    token: ctx.token,
    taskId: generated.taskId,
  });

  // Step 5: Append new help entry to history
  const newHelpEntry: HelpEntry = {
    user: modification,
    help: { text: modification },
    type: "user",
    timestamp: new Date().toISOString(),
    taskId: generated.taskId,
  };
  const updatedHelp = JSON.stringify([...existingHelp, newHelpEntry]);

  // Step 6: Update item with new code and help history
  const updatedItem = await apiUpdateItem({
    token: ctx.token,
    id: item_id,
    taskId: generated.taskId,
    code: generated.code,
    help: updatedHelp,
  });

  return {
    item_id: updatedItem.id,
    task_id: generated.taskId,
    language: `L${updatedItem.lang}`,
    name: updatedItem.name,
    description: generated.description,
    data,
    usage: generated.usage,
    hint: "Call get_language_info() for React component usage and embedding instructions.",
    // Widget-only data (not exposed to model)
    _meta: {
      access_token: ctx.token,
    },
  };
}

export async function handleGetItem(
  ctx: ToolContext,
  args: { item_id: string }
): Promise<unknown> {
  const { item_id } = args;

  // Get item metadata
  const item = await apiGetItem({
    token: ctx.token,
    id: item_id,
  });

  if (!item) {
    throw new Error(`Item not found: ${item_id}`);
  }

  // Get compiled data
  const data = await getData({
    token: ctx.token,
    taskId: item.taskId,
  });

  return {
    item_id: item.id,
    task_id: item.taskId,
    language: `L${item.lang}`,
    name: item.name,
    code: item.code,
    data,
    created: item.created,
    updated: item.updated,
    hint: "Call get_language_info() for React component usage and embedding instructions.",
    // Widget-only data (not exposed to model)
    _meta: {
      access_token: ctx.token,
    },
  };
}

export async function handleListLanguages(
  ctx: ToolContext,
  args: { category?: string; search?: string }
): Promise<unknown> {
  const languages = await apiListLanguages({
    token: ctx.token,
    category: args.category,
    search: args.search,
  });

  return {
    languages: languages.map(lang => ({
      id: `L${lang.id}`,
      name: lang.name,
      description: lang.description,
      category: lang.category,
    })),
  };
}

export async function handleGetLanguageInfo(
  ctx: ToolContext,
  args: { language: string }
): Promise<unknown> {
  const info = await apiGetLanguageInfo({
    token: ctx.token,
    language: args.language,
  });

  if (!info) {
    throw new Error(`Language not found: ${args.language}`);
  }

  const reactUsage = getReactUsage(info.id);

  // Derive usage guide URL from spec URL
  // spec URL pattern: https://l0169.graffiticode.org/spec.html
  // usage guide URL:  https://l0169.graffiticode.org/usage-guide.html
  const usageGuideUrl = info.specUrl
    ? info.specUrl.replace(/spec\.html$/, "usage-guide.html")
    : null;

  return {
    id: `L${info.id}`,
    name: info.name,
    description: info.description,
    category: info.category,
    usage_guide_url: usageGuideUrl,
    spec_url: info.specUrl,
    react_usage: reactUsage,
  };
}

// Tool handler router
export async function handleToolCall(
  ctx: ToolContext,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (toolName) {
    case "create_item":
      return handleCreateItem(ctx, args as { language: string; description: string; name?: string });
    case "update_item":
      return handleUpdateItem(ctx, args as { item_id: string; modification: string });
    case "get_item":
      return handleGetItem(ctx, args as { item_id: string });
    case "list_languages":
      return handleListLanguages(ctx, args as { category?: string; search?: string });
    case "get_language_info":
      return handleGetLanguageInfo(ctx, args as { language: string });
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
