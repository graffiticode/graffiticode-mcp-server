import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  getData,
  getItemWithTask as apiGetItemWithTask,
  startCodeGeneration,
  listLanguages as apiListLanguages,
  getLanguageInfo as apiGetLanguageInfo,
  type AuthContext,
  CONSOLE_URL,
  APP_URL,
  API_URL,
} from "./api.js";
import { mintClaimToken } from "./claim-token.js";
import { getRenderAccessToken } from "./render-token.js";
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

Workflow: list_languages(search, domain) → get_language_info(language) → create_item(language, description) → get_item(item_id) → update_item(item_id, modification) → get_item(item_id) to iterate.

create_item and update_item start generation and return immediately with status "generating"; always follow them with get_item(item_id) to retrieve the result. get_item waits for completion and returns status "ready" (with data), "failed" (with an error), or "generating" (call get_item again).`;

// --- Tool Definitions ---

export const createItemTool = {
  name: "create_item",
  description: `Create interactive content in any Graffiticode language. Describe what you want in natural language — a language-specific AI generates the result.

Call list_languages() first to discover available languages, then pass the language ID here. The description should be a natural language request, not code. Be specific about the content, structure, layout, theme, and any assessment or interaction requirements.

Generation runs asynchronously: this returns immediately with an item_id and status "generating". Call get_item(item_id) to retrieve the result — get_item waits for completion and returns status "ready" with the data (or "failed").`,
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
    // Signals to Codex/ChatGPT hosts that this tool's result can render a
    // widget. Codex Desktop checks this before issuing read-mcp-resource (the
    // inline-UI path is still flag-gated there, but this keeps us correct for
    // when it ships). See openai/codex#21019.
    "openai/resultCanProduceWidget": true,
    // Claude / MCP Apps metadata: nested key is preferred; flat key is the
    // deprecated alias older hosts read.
    ui: { resourceUri: CLAUDE_WIDGET_RESOURCE_URI },
    "ui/resourceUri": CLAUDE_WIDGET_RESOURCE_URI,
  },
} as const;

export const updateItemTool = {
  name: "update_item",
  description: `Modify an existing Graffiticode item by describing what to change in natural language.

The language is auto-detected from the item. Conversation history is preserved, so you can make incremental changes: "add another concept", "change the theme to dark", "make the header row blue".

Like create_item, generation runs asynchronously: this returns immediately with status "generating". Call get_item(item_id) to retrieve the updated result (it waits for completion).`,
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
    // Signals to Codex/ChatGPT hosts that this tool's result can render a
    // widget. Codex Desktop checks this before issuing read-mcp-resource (the
    // inline-UI path is still flag-gated there, but this keeps us correct for
    // when it ships). See openai/codex#21019.
    "openai/resultCanProduceWidget": true,
    // Claude / MCP Apps metadata: nested key is preferred; flat key is the
    // deprecated alias older hosts read.
    ui: { resourceUri: CLAUDE_WIDGET_RESOURCE_URI },
    "ui/resourceUri": CLAUDE_WIDGET_RESOURCE_URI,
  },
} as const;

export const getItemTool = {
  name: "get_item",
  description: `Get an existing Graffiticode item by ID.

Returns the item's data, code, and metadata. If the item is still being generated (after create_item/update_item), this waits for completion and returns it once ready. Response includes a status field: "ready" (data present), "generating" (call get_item again to keep waiting), or "failed" (with an error).`,
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
    // Signals to Codex/ChatGPT hosts that this tool's result can render a
    // widget. Codex Desktop checks this before issuing read-mcp-resource (the
    // inline-UI path is still flag-gated there, but this keeps us correct for
    // when it ships). See openai/codex#21019.
    "openai/resultCanProduceWidget": true,
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
// - firebase items: embed an access_token the token-authenticated /form
//   endpoint accepts. The api only validates JWTs, so we must NOT embed a raw
//   API key (it's rejected → 404, and a long-lived key in a URL leaks into
//   logs). For a raw-key bearer we exchange it for a short-lived (5-min) access
//   token; an OAuth bearer is already a Firebase ID token and is used directly.
// - free-plan items: the compiled task is created anonymously, so it carries a
//   public ACL and /form renders it by taskId with no token. (Item-level
//   session namespacing doesn't apply here — /form keys on the task, not the
//   item.)
async function buildFormUrl(
  auth: AuthContext,
  taskId: string | null
): Promise<string | undefined> {
  if (!taskId) return undefined;
  const base = `${API_URL}/form?id=${encodeURIComponent(taskId)}`;
  if (auth.type !== "firebase") return base;

  let token: string | null = auth.token;
  if (auth.source === "raw") {
    token = await getRenderAccessToken(auth.token);
    // Exchange failed — omit form_url rather than embed a rejected/leaky key.
    // The widget then falls back to its "Open in Graffiticode" view link.
    if (!token) return undefined;
  }
  return `${base}&access_token=${encodeURIComponent(token)}`;
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

// Shape returned by create_item / update_item and by get_item while a
// generation is still running. The model is expected to poll get_item until
// status flips to "ready".
//
// No view_url/claim_url here: those links are only meaningful once the item has
// content, and the MCP client renders the response JSON as chat text — emitting
// them now would surface (and repeat, on every poll) an "Open in Graffiticode"
// link before anything exists. They're added on the get_item "ready" response.
function buildGeneratingResponse(
  itemId: string,
  lang: string,
  name: string | null
): Record<string, unknown> {
  return {
    item_id: itemId,
    status: "generating",
    language: `L${lang}`,
    name: name ?? null,
    message:
      "Generation started. Call get_item(item_id) to retrieve the result — it waits for completion and returns status 'ready' with the data (or 'failed').",
  };
}

// Human-readable, link-forward summary for the get_item "ready" response. Used
// as the tool result's text content for clients that render text instead of
// the widget iframe (e.g. Codex Desktop, whose inline MCP-Apps UI is still
// flag-gated). Widget hosts ignore it.
function buildReadySummary(
  name: string | null,
  language: string,
  viewUrl: string,
  claimMessage?: string
): string {
  const title = name ? `**${name}**` : "Your item";
  const lines = [
    `${title} (${language}) is ready — open the form view: ${viewUrl}`,
  ];
  if (claimMessage) lines.push(claimMessage);
  return lines.join("\n\n");
}

export async function handleCreateItem(
  ctx: ToolContext,
  args: { language: string; description: string; name?: string }
): Promise<unknown> {
  const { language, description, name } = args;

  // Normalize language ID (remove "L" prefix if present)
  const langId = language.replace(/^L/i, "");

  // Start async generation (creates the item shell + enqueues the work) and
  // return immediately. No long-running tool call.
  const job = await startCodeGeneration({
    auth: ctx.auth,
    lang: langId,
    name,
    client: "mcp",
    prompt: description,
    modification: description,
  });

  return buildGeneratingResponse(job.itemId, langId, name ?? null);
}

export async function handleUpdateItem(
  ctx: ToolContext,
  args: { item_id: string; modification: string }
): Promise<unknown> {
  const { item_id, modification } = args;

  // Fetch existing item + task src to build the contextual prompt.
  const existingItem = await apiGetItemWithTask({
    auth: ctx.auth,
    id: item_id,
  });

  if (!existingItem) {
    throw new Error(`Item not found: ${item_id}`);
  }

  const currentSrc = existingItem.task?.src ?? null;
  const existingHelp = parseHelp(existingItem.help);
  const contextualPrompt = buildContextualPrompt(existingHelp, modification);

  // Start async generation against the existing item and return immediately.
  // The worker appends the help entry and persists the new taskId on completion.
  const job = await startCodeGeneration({
    auth: ctx.auth,
    itemId: item_id,
    lang: existingItem.lang,
    prompt: contextualPrompt,
    modification,
    currentSrc,
  });

  return buildGeneratingResponse(job.itemId, existingItem.lang, existingItem.name);
}

const GET_ITEM_POLL_DEADLINE_MS = 45_000; // under codex's ~60s tool-call cap
const GET_ITEM_POLL_INTERVAL_MS = 2_500;
const GENERATION_STALE_MS = 4 * 60_000; // worker-died guard

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The Graffiticode API's data(id) resolver returns this envelope when a task's
// rendered data isn't available: { status: "error", error: { code, message } }.
// Match it specifically (status:"error" + numeric error.code) so we don't
// mistake a real item's data for an error.
function isErrorEnvelope(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.status !== "error") return false;
  const err = o.error as Record<string, unknown> | undefined;
  return !!err && typeof err === "object" && typeof err.code === "number";
}

// During the brief window after create/update the item can transiently point at
// a template/old task whose data hasn't been computed yet, so a too-eager
// "ready" classification would surface a 404 blob. The envelope can arrive
// either at the top level of the getData payload or nested under `.data` (the
// real content lives at `.data` for a successful render, e.g. L0158/L0166), so
// check both levels.
function isErrorDataPayload(data: unknown): boolean {
  if (isErrorEnvelope(data)) return true;
  if (data && typeof data === "object") {
    return isErrorEnvelope((data as Record<string, unknown>).data);
  }
  return false;
}

// get_item long-polls: while the item is still generating it waits (up to ~45s,
// under the client tool-call timeout; the server.ts heartbeat keeps the stream
// warm) and returns the moment the item is ready/failed. A single create_item
// followed by get_item therefore completes without ever holding a 60-110s call.
export async function handleGetItem(
  ctx: ToolContext,
  args: { item_id: string }
): Promise<unknown> {
  const { item_id } = args;
  const deadline = Date.now() + GET_ITEM_POLL_DEADLINE_MS;

  for (;;) {
    const item = await apiGetItemWithTask({ auth: ctx.auth, id: item_id });
    if (!item) {
      throw new Error(`Item not found: ${item_id}`);
    }

    const status = item.generationStatus;

    if (status === "failed") {
      // No view_url/claim_url: a failed item has nothing to open or claim.
      return {
        item_id: item.id,
        status: "failed",
        error: item.generationError || "Generation failed",
        language: `L${item.lang}`,
        name: item.name,
      };
    }

    if (status === "generating") {
      const startedAt = item.generationStartedAt ? Number(item.generationStartedAt) : 0;
      const stale = startedAt > 0 && Date.now() - startedAt > GENERATION_STALE_MS;
      if (stale) {
        return {
          item_id: item.id,
          status: "failed",
          error: "Generation timed out",
          language: `L${item.lang}`,
          name: item.name,
        };
      }
      if (Date.now() < deadline) {
        await sleep(GET_ITEM_POLL_INTERVAL_MS);
        continue;
      }
      // Deadline reached but still generating — return so the model polls again.
      // No view_url/claim_url until the item is ready (see buildGeneratingResponse).
      return {
        item_id: item.id,
        status: "generating",
        language: `L${item.lang}`,
        name: item.name,
        message: "Still generating. Call get_item(item_id) again to keep waiting.",
      };
    }

    // Ready (status "ready" or legacy/sync item with no status). Needs a task.
    if (!item.task || !item.taskId) {
      // Status says ready/absent but the task isn't visible yet — brief lag.
      if (Date.now() < deadline) {
        await sleep(GET_ITEM_POLL_INTERVAL_MS);
        continue;
      }
      throw new Error(`Task not found for item: ${item_id}`);
    }

    const data = await getData({ auth: ctx.auth, taskId: item.taskId });

    // The item reports ready and its task is visible, but the rendered data
    // isn't available yet (data(id) returned a 404 envelope) — a transient
    // intermediate during create/update. Keep polling rather than returning a
    // "ready" item carrying a broken data blob; resolves once real data lands.
    if (isErrorDataPayload(data)) {
      if (Date.now() < deadline) {
        await sleep(GET_ITEM_POLL_INTERVAL_MS);
        continue;
      }
      return {
        item_id: item.id,
        status: "generating",
        language: `L${item.lang}`,
        name: item.name,
        message: "Still generating. Call get_item(item_id) again to keep waiting.",
      };
    }

    const response: Record<string, unknown> = {
      item_id: item.id,
      task_id: item.taskId,
      status: "ready",
      language: `L${item.lang}`,
      name: item.name,
      src: item.task.src,
      data,
      created: item.created,
      updated: item.updated,
    };
    await applyViewAndClaim(response, ctx.auth, item.id);
    const formUrl = await buildFormUrl(ctx.auth, item.taskId);
    if (formUrl) response._meta = { form_url: formUrl };
    // Chat-facing summary for clients that render text rather than the widget
    // (e.g. Codex). Surfaces the form-view link instead of dumping the full
    // JSON (src + data). Widget hosts ignore this and render the iframe.
    response.summary = buildReadySummary(
      item.name,
      `L${item.lang}`,
      response.view_url as string,
      response.claim_message as string | undefined
    );
    return response;
  }
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
