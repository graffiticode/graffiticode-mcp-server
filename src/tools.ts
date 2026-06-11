import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  generateCode,
  getData,
  getItemWithTask as apiGetItemWithTask,
  createItem as apiCreateItem,
  updateItem as apiUpdateItem,
  listLanguages as apiListLanguages,
  getLanguageInfo as apiGetLanguageInfo,
  type AuthContext,
  CONSOLE_URL,
  APP_URL,
  API_URL,
} from "./api.js";
import { mintClaimToken } from "./claim-token.js";
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
  newMessage: string
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

  // NB: we deliberately do NOT inline the current source here. generateCode()
  // already receives it as the typed `currentSrc` argument, so embedding it in
  // the prompt text is redundant — and on the free-plan path it pushed the
  // prompt past the backend's 2000-char cap, failing every edit of a non-trivial
  // item. Keep the prompt to conversation history + the new request only.
  context += "\nNow, please address this new request:\n";
  return context + newMessage;
}

// --- Server Instructions (sent to agents at connection time) ---

export const SERVER_INSTRUCTIONS = `Graffiticode is an open-ended platform of domain-specific tools for creating interactive content — assessments, spreadsheets, flashcards, and more. The catalog of available tools grows over time.

When the user's request doesn't match another available tool, call list_languages() to check if Graffiticode has a language that fits. Use the search parameter to match by keyword, or the domain parameter to narrow by domain (e.g., 'assessments', 'sheets', 'diagrams', 'learnosity') when the user's context implies one. If a match exists, call get_language_info() to learn what the language can create and get its user guide resource URI, then call create_item() with a natural language description.

All requests to create_item and update_item must be natural language descriptions of what to create or change. A language-specific AI backend handles all code generation. Do not attempt to generate Graffiticode DSL code directly.

get_language_info returns an inline authoring_guide summary, supported_item_types, and example_prompts — these are usually sufficient to compose a good create_item request. For deeper reference (vocabulary cues, scope boundaries, detailed item-type docs) read the user_guide_resource URI via ReadResource.

Workflow: list_languages(search, domain) → get_language_info(language) → create_item(language, description) → update_item(item_id, modification) to iterate.`;

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
    // Claude / MCP Apps metadata: nested key is preferred; flat key is the
    // deprecated alias older hosts read.
    ui: { resourceUri: CLAUDE_WIDGET_RESOURCE_URI },
    "ui/resourceUri": CLAUDE_WIDGET_RESOURCE_URI,
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
    // Claude / MCP Apps metadata: nested key is preferred; flat key is the
    // deprecated alias older hosts read.
    ui: { resourceUri: CLAUDE_WIDGET_RESOURCE_URI },
    "ui/resourceUri": CLAUDE_WIDGET_RESOURCE_URI,
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
    // Claude / MCP Apps metadata: nested key is preferred; flat key is the
    // deprecated alias older hosts read.
    ui: { resourceUri: CLAUDE_WIDGET_RESOURCE_URI },
    "ui/resourceUri": CLAUDE_WIDGET_RESOURCE_URI,
  },
} as const;

export const listLanguagesTool = {
  name: "list_languages",
  description: `Discover available Graffiticode languages. Use this to find a language that matches the user's needs.

The catalog is dynamic and grows over time. Use the search parameter to match by keyword (e.g., "spreadsheet", "assessment", "flashcard"), or the domain parameter to narrow to a domain (e.g., "assessments"). Returns language IDs, names, descriptions, and domain memberships.`,
  inputSchema: {
    type: "object",
    properties: {
      domain: {
        type: "string",
        description: "Filter by domain (e.g., 'assessments', 'sheets', 'diagrams', 'learnosity'). Omit to see every Graffiticode language. Discover available values from the `domains` field on returned languages.",
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
  description: `Get detailed authoring information about a Graffiticode language.

Returns an inline authoring_guide summary, supported_item_types, example_prompts, and a user_guide_resource URI (readable via ReadResource for the full markdown guide). Usually sufficient to compose a good create_item request.

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

// --- Tool Handlers ---

export interface ToolContext {
  auth: AuthContext;
}

// Build the URL the inline widget embeds in its iframe to render the item.
// Returned in tool-result `_meta` (widget-only, hidden from the model). The
// API's /form endpoint renders by taskId and derives the language from the task
// itself, so no `lang` query param is needed.
//
// - firebase items: pass the access_token so the token-authenticated /form
//   endpoint can read the owner-scoped task.
// - free-plan items: the compiled task is created anonymously, so it carries a
//   public ACL and /form renders it by taskId with no token. (Item-level
//   session namespacing doesn't apply here — /form keys on the task, not the
//   item.)
function buildFormUrl(
  auth: AuthContext,
  taskId: string | null
): string | undefined {
  if (!taskId) return undefined;
  const base = `${API_URL}/form?id=${encodeURIComponent(taskId)}`;
  return auth.type === "firebase"
    ? `${base}&access_token=${encodeURIComponent(auth.token)}`
    : base;
}

// The app's view page for an item, opened in a full browser tab (where a
// signed-in user has a session). Surfaced as `view_url` for the widget's
// "Open in Graffiticode" link.
function buildViewUrl(itemId: string, claimToken?: string | null): string {
  const base = `${APP_URL}/form/${itemId}`;
  // Embed the claim token on free-plan view links so the render-host footer can
  // offer a one-click "Claim it in Graffiticode" link for this exact item. The
  // JWT is URL-safe (base64url), so no extra encoding is needed.
  return claimToken ? `${base}?claim=${claimToken}` : base;
}

// For trial-mode responses, mint a 24h JWT and return the claim token plus the
// fields the console's /claim page consumes. Returns null when not a free-plan
// call or when FREE_PLAN_NAMESPACE_SALT isn't configured (graceful degrade).
async function buildClaimFields(
  auth: AuthContext
): Promise<{ token: string; claim_url: string; claim_message: string } | null> {
  if (auth.type !== "freePlan") return null;
  const token = await mintClaimToken(auth.sessionId);
  if (!token) return null;
  const claim_url = `${CONSOLE_URL}/claim?token=${token}`;
  return {
    token,
    claim_url,
    claim_message: `Your item is ready. To save it permanently, sign in at: ${claim_url}`,
  };
}

// Set `view_url` (with the claim token embedded for free-plan items, so the
// render-host footer can offer a "Claim it" link for this exact item) plus the
// claim_url/claim_message fields. The raw token is intentionally not surfaced as
// its own response field.
async function applyViewAndClaim(
  obj: Record<string, unknown>,
  auth: AuthContext,
  itemId: string
): Promise<void> {
  const claimFields = await buildClaimFields(auth);
  obj.view_url = buildViewUrl(itemId, claimFields?.token);
  if (claimFields) {
    obj.claim_url = claimFields.claim_url;
    obj.claim_message = claimFields.claim_message;
  }
}

export async function handleCreateItem(
  ctx: ToolContext,
  args: { language: string; description: string; name?: string }
): Promise<unknown> {
  const { language, description, name } = args;

  // Normalize language ID (remove "L" prefix if present)
  const langId = language.replace(/^L/i, "");

  // Step 1: Create item from language template (no taskId — backend generates from template)
  const item = await apiCreateItem({
    auth: ctx.auth,
    lang: langId,
    name,
    client: "mcp",
  });

  // Step 2: Update the item with the user's description
  return handleUpdateItem(ctx, { item_id: item.id, modification: description });
}

export async function handleUpdateItem(
  ctx: ToolContext,
  args: { item_id: string; modification: string }
): Promise<unknown> {
  const { item_id, modification } = args;

  // Step 1: Fetch existing item and its task src in a single round-trip.
  const existingItem = await apiGetItemWithTask({
    auth: ctx.auth,
    id: item_id,
  });

  if (!existingItem) {
    throw new Error(`Item not found: ${item_id}`);
  }

  if (!existingItem.task) {
    throw new Error(`Task not found for item: ${item_id}`);
  }

  const currentSrc = existingItem.task.src;

  // Step 2: Parse existing help history and build contextual prompt
  const existingHelp = parseHelp(existingItem.help);
  const contextualPrompt = buildContextualPrompt(existingHelp, modification);

  // Step 3: Generate updated code with contextual prompt
  const generated = await generateCode({
    auth: ctx.auth,
    prompt: contextualPrompt,
    language: existingItem.lang,
    currentSrc,
    itemId: item_id,
  });

  if (generated.errors?.length) {
    // Generation was rejected — nothing was persisted. Surface this explicitly:
    // `status: "failed"` + `error` make the failure unambiguous, since the `src`
    // we return is the *unchanged* prior source and would otherwise read like a
    // successful no-op. `hint` is retained as a back-compat alias.
    const errorMessage = generated.errors.map(e => e.message).join("\n");
    const result: Record<string, unknown> = {
      item_id,
      task_id: null,
      status: "failed",
      error: errorMessage,
      language: `L${existingItem.lang}`,
      name: existingItem.name,
      src: currentSrc,
      description: null,
      change_summary: null,
      data: null,
      usage: generated.usage,
      created: existingItem.created,
      updated: existingItem.updated,
      hint: errorMessage,
    };
    await applyViewAndClaim(result, ctx.auth, item_id);
    // No taskId on a generation error, so there is nothing to render inline.
    return result;
  }

  if (!generated.taskId) {
    throw new Error("No taskId returned from code generation");
  }

  // Step 4: Append new help entry to history
  const newHelpEntry: HelpEntry = {
    user: modification,
    help: { text: modification },
    type: "user",
    timestamp: new Date().toISOString(),
    taskId: generated.taskId,
  };
  const updatedHelp = JSON.stringify([...existingHelp, newHelpEntry]);

  // Step 5: Fetch compiled data and persist the new taskId + help in parallel.
  // These are independent — the response only needs `data` from getData and
  // metadata fields (id, lang, name, created, updated) that come back from
  // apiUpdateItem. Promise.all still surfaces a write failure as an error.
  const [data, updatedItem] = await Promise.all([
    getData({
      auth: ctx.auth,
      taskId: generated.taskId,
    }),
    apiUpdateItem({
      auth: ctx.auth,
      id: item_id,
      taskId: generated.taskId,
      help: updatedHelp,
    }),
  ]);

  const response: Record<string, unknown> = {
    item_id: updatedItem.id,
    task_id: generated.taskId,
    language: `L${updatedItem.lang}`,
    name: updatedItem.name,
    src: generated.src,
    description: generated.description,
    change_summary: generated.changeSummary,
    data,
    usage: generated.usage,
    created: updatedItem.created,
    updated: updatedItem.updated,
  };
  await applyViewAndClaim(response, ctx.auth, updatedItem.id);
  const formUrl = buildFormUrl(ctx.auth, generated.taskId);
  if (formUrl) response._meta = { form_url: formUrl };
  return response;
}

export async function handleGetItem(
  ctx: ToolContext,
  args: { item_id: string }
): Promise<unknown> {
  const { item_id } = args;

  // Fetch item + task src in one round-trip, then compiled data.
  const item = await apiGetItemWithTask({ auth: ctx.auth, id: item_id });
  if (!item) {
    throw new Error(`Item not found: ${item_id}`);
  }
  if (!item.task) {
    throw new Error(`Task not found for item: ${item_id}`);
  }

  const data = await getData({
    auth: ctx.auth,
    taskId: item.taskId,
  });

  const response: Record<string, unknown> = {
    item_id: item.id,
    task_id: item.taskId,
    language: `L${item.lang}`,
    name: item.name,
    src: item.task.src,
    data,
    created: item.created,
    updated: item.updated,
  };
  await applyViewAndClaim(response, ctx.auth, item.id);
  const formUrl = buildFormUrl(ctx.auth, item.taskId);
  if (formUrl) response._meta = { form_url: formUrl };
  return response;
}

export async function handleListLanguages(
  ctx: ToolContext,
  args: { domain?: string; search?: string }
): Promise<unknown> {
  const languages = await apiListLanguages({
    auth: ctx.auth,
    domain: args.domain,
    search: args.search,
  });

  return {
    languages: languages.map(lang => ({
      id: `L${lang.id}`,
      name: lang.name,
      description: lang.description,
      domains: lang.domains,
    })),
  };
}

export async function handleGetLanguageInfo(
  ctx: ToolContext,
  args: { language: string }
): Promise<unknown> {
  const info = await apiGetLanguageInfo({
    auth: ctx.auth,
    language: args.language,
  });

  if (!info) {
    throw new Error(`Language not found: ${args.language}`);
  }

  return {
    id: `L${info.id}`,
    name: info.name,
    description: info.description,
    domains: info.domains,
    authoring_guide: info.authoringGuide ?? null,
    supported_item_types: info.supportedItemTypes ?? [],
    example_prompts: info.examplePrompts ?? [],
    user_guide_resource: `graffiticode://language/L${info.id}/user-guide`,
    spec_url: info.specUrl,
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
      return handleListLanguages(ctx, args as { domain?: string; search?: string });
    case "get_language_info":
      return handleGetLanguageInfo(ctx, args as { language: string });
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
