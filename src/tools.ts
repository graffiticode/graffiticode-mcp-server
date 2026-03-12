import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  generateCode,
  getData,
  createItem as apiCreateItem,
  getItem as apiGetItem,
  updateItem as apiUpdateItem,
  listLanguages as apiListLanguages,
  getLanguageInfo as apiGetLanguageInfo,
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

// --- Tool Definitions ---

export const createItemTool = {
  name: "create_item",
  description: `Create a new Graffiticode item in any language.

The language parameter specifies which DSL to use. Call list_languages() to discover available options.

Returns item_id for use in subsequent update_item or get_item calls.`,
  inputSchema: {
    type: "object",
    properties: {
      language: {
        type: "string",
        description: "Language ID (e.g., 'L0166'). Call list_languages() to see options.",
      },
      description: {
        type: "string",
        description: "Natural language description of what to create",
      },
      name: {
        type: "string",
        description: "Optional friendly name for the item",
      },
    },
    required: ["language", "description"],
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
  description: `Update an existing Graffiticode item.

Args:
  item_id: The item_id from a previous create_item call
  modification: Natural language description of what to change

Language is auto-detected from the item.`,
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
  description: `Discover available Graffiticode languages.

Returns list of languages with IDs, names, descriptions, and categories.`,
  inputSchema: {
    type: "object",
    properties: {
      category: {
        type: "string",
        description: "Optional filter by category",
      },
      search: {
        type: "string",
        description: "Optional search by keyword",
      },
    },
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
} as const;

export const getLanguageInfoTool = {
  name: "get_language_info",
  description: `Get high-level information about a Graffiticode language.

Returns name, description, category, spec URL, and React usage instructions.`,
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

  // Step 1: Generate code from description (routes to language-specific backend)
  const generated = await generateCode({
    token: ctx.token,
    prompt: description,
    language: langId,
  });

  if (!generated.taskId) {
    throw new Error("No taskId returned from code generation");
  }

  // Step 2: Get compiled data
  const data = await getData({
    token: ctx.token,
    taskId: generated.taskId,
  });

  // Step 3: Build help array with initial entry
  const helpEntry: HelpEntry = {
    user: description,
    help: { text: description },
    type: "user",
    timestamp: new Date().toISOString(),
    taskId: generated.taskId,
  };
  const help = JSON.stringify([helpEntry]);

  // Step 4: Create item with help context
  const item = await apiCreateItem({
    token: ctx.token,
    lang: langId,
    name,
    taskId: generated.taskId,
    code: generated.code,
    help,
    app: "mcp",
  });

  const reactUsage = getReactUsage(langId);

  return {
    item_id: item.id,
    task_id: generated.taskId,
    language: `L${langId}`,
    name: item.name,
    description: generated.description,
    code: generated.code,
    data,
    react_usage: reactUsage,
    usage: generated.usage,
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

  const reactUsage = getReactUsage(updatedItem.lang);

  return {
    item_id: updatedItem.id,
    task_id: generated.taskId,
    language: `L${updatedItem.lang}`,
    name: updatedItem.name,
    description: generated.description,
    data,
    react_usage: reactUsage,
    usage: generated.usage,
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

  const reactUsage = getReactUsage(item.lang);

  return {
    item_id: item.id,
    task_id: item.taskId,
    language: `L${item.lang}`,
    name: item.name,
    code: item.code,
    data,
    react_usage: reactUsage,
    created: item.created,
    updated: item.updated,
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

  return {
    id: `L${info.id}`,
    name: info.name,
    description: info.description,
    category: info.category,
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
