/**
 * Graffiticode GraphQL API client
 */

const CONSOLE_API_URL = process.env.GRAFFITICODE_CONSOLE_URL || "https://console.graffiticode.org/api";

// Graffiticode API host. Serves language templates and the `/form` render
// endpoint embedded by the inline widgets (token-authenticated).
export const API_URL = process.env.GRAFFITICODE_API_URL || "https://api.graffiticode.org";

// Bare-host URLs used to construct user-facing links (claim_url, view_url)
// surfaced on trial-mode tool responses. Distinct from CONSOLE_API_URL above,
// which already ends in /api.
export const CONSOLE_URL = process.env.GRAFFITICODE_CONSOLE_BASE_URL || "https://console.graffiticode.org";
export const APP_URL = process.env.GRAFFITICODE_APP_URL || "https://app.graffiticode.org";

export type AuthContext =
  // `source` records how the bearer was resolved (see server.ts resolveBearer):
  // "oauth" — already a Firebase ID token; "raw" — the caller's raw Graffiticode
  // API key (forwarded verbatim to the console, which exchanges it). It governs
  // how buildFormUrl mints the token embedded in the render URL.
  | { type: "firebase"; token: string; source?: "oauth" | "raw" }
  | { type: "freePlan"; sessionId: string };

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

function buildAuthHeaders(auth: AuthContext): Record<string, string> {
  if (auth.type === "firebase") {
    return { Authorization: auth.token };
  }
  return { "X-Free-Plan-Session": auth.sessionId };
}

async function graphqlRequest<T>(
  auth: AuthContext,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const response = await fetch(CONSOLE_API_URL, {
    method: "POST",
    headers: {
      ...buildAuthHeaders(auth),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GraphQL request failed: ${error}`);
  }

  const result = await response.json() as GraphQLResponse<T>;

  if (result.errors && result.errors.length > 0) {
    throw new Error(`GraphQL error: ${result.errors[0].message}`);
  }

  if (!result.data) {
    throw new Error("No data returned from GraphQL");
  }

  return result.data;
}

// --- Generate Code ---

interface GenerateCodeResult {
  src: string;
  taskId: string;
  description: string | null;
  changeSummary: string | null;
  language: string;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  errors?: Array<{ message: string }>;
}

export async function generateCode(options: {
  auth: AuthContext;
  prompt: string;
  language: string;
  currentSrc?: string;
  itemId?: string;
}): Promise<GenerateCodeResult> {
  const { auth, prompt, language, currentSrc, itemId } = options;

  const query = `
    mutation GenerateCode($prompt: String!, $language: String!, $currentSrc: String, $itemId: String) {
      generateCode(prompt: $prompt, language: $language, currentSrc: $currentSrc, itemId: $itemId) {
        src
        taskId
        description
        changeSummary
        language
        model
        usage {
          input_tokens
          output_tokens
        }
        errors {
          message
        }
      }
    }
  `;

  const result = await graphqlRequest<{ generateCode: GenerateCodeResult }>(
    auth,
    query,
    { prompt, language, currentSrc, itemId }
  );

  return result.generateCode;
}

// Start async generation: the console marks the item "generating", enqueues a
// Cloud Task to run the (60-110s) generation, and returns immediately. Pass an
// existing itemId to update, or omit it to create a new shell item (the server
// returns its id). Poll get_item until generationStatus flips to ready/failed.
export interface GenerationJobResult {
  itemId: string;
  status: string;
}

export async function startCodeGeneration(options: {
  auth: AuthContext;
  itemId?: string;
  lang: string;
  name?: string;
  client?: string;
  prompt: string;
  modification: string;
  currentSrc?: string | null;
}): Promise<GenerationJobResult> {
  const { auth, itemId, lang, name, client, prompt, modification, currentSrc } = options;

  const mutation = `
    mutation StartCodeGeneration($itemId: String, $lang: String!, $name: String, $client: String, $prompt: String!, $modification: String!, $currentSrc: String) {
      startCodeGeneration(itemId: $itemId, lang: $lang, name: $name, client: $client, prompt: $prompt, modification: $modification, currentSrc: $currentSrc) {
        itemId
        status
      }
    }
  `;

  const result = await graphqlRequest<{ startCodeGeneration: GenerationJobResult }>(
    auth,
    mutation,
    { itemId, lang, name, client, prompt, modification, currentSrc }
  );

  return result.startCodeGeneration;
}

// --- Get Data ---

export async function getData(options: {
  auth: AuthContext;
  taskId: string;
}): Promise<unknown> {
  const { auth, taskId } = options;

  const query = `
    query GetData($id: String!) {
      data(id: $id)
    }
  `;

  const result = await graphqlRequest<{ data: string }>(
    auth,
    query,
    { id: taskId }
  );

  return JSON.parse(result.data);
}

// --- Get Task ---

export async function getTask(options: {
  auth: AuthContext;
  id: string;
}): Promise<{ id: string; lang: string; code: string; src: string }> {
  const { auth, id } = options;

  const query = `
    query GetTask($id: String!) {
      task(id: $id) {
        id
        lang
        code
        src
      }
    }
  `;

  const result = await graphqlRequest<{ task: { id: string; lang: string; code: string; src: string } }>(
    auth,
    query,
    { id }
  );

  return result.task;
}

// --- Item CRUD ---

export interface Item {
  id: string;
  name: string | null;
  taskId: string | null;
  lang: string;
  help: string | null;
  isPublic: boolean;
  created: string;
  updated: string;
  client: string | null;
  // Async-generation status. Absent/null ⇒ legacy/ready.
  generationStatus?: "generating" | "ready" | "failed" | null;
  generationError?: string | null;
  generationStartedAt?: string | null;
}

export async function createItem(options: {
  auth: AuthContext;
  lang: string;
  name?: string;
  taskId?: string;
  help?: string;
  client?: string;
}): Promise<Item> {
  const { auth, lang, name, taskId, help, client } = options;

  const mutation = `
    mutation CreateItem($lang: String!, $name: String, $taskId: String, $help: String, $client: String) {
      createItem(lang: $lang, name: $name, taskId: $taskId, help: $help, client: $client) {
        id
        name
        taskId
        lang
        help
        isPublic
        created
        updated
        client
      }
    }
  `;

  const result = await graphqlRequest<{ createItem: Item }>(
    auth,
    mutation,
    { lang, name, taskId, help, client }
  );

  return result.createItem;
}

export async function getItem(options: {
  auth: AuthContext;
  id: string;
}): Promise<Item | null> {
  const { auth, id } = options;

  const query = `
    query GetItem($id: String!) {
      item(id: $id) {
        id
        name
        taskId
        lang
        help
        isPublic
        created
        updated
        client
      }
    }
  `;

  const result = await graphqlRequest<{ item: Item | null }>(
    auth,
    query,
    { id }
  );

  return result.item;
}

export interface ItemWithTask extends Item {
  task: {
    id: string;
    lang: string;
    code: string;
    src: string;
  } | null;
}

export async function getItemWithTask(options: {
  auth: AuthContext;
  id: string;
}): Promise<ItemWithTask | null> {
  const { auth, id } = options;

  const query = `
    query GetItemWithTask($id: String!) {
      item(id: $id) {
        id
        name
        taskId
        lang
        help
        isPublic
        created
        updated
        client
        generationStatus
        generationError
        generationStartedAt
        task {
          id
          lang
          code
          src
        }
      }
    }
  `;

  const result = await graphqlRequest<{ item: ItemWithTask | null }>(
    auth,
    query,
    { id }
  );

  return result.item;
}

export interface ItemSpec {
  spec: string;
  lang: string;
  itemId: string;
  coverage: { checked: number; missing: string[] };
}

export async function getSpec(options: {
  auth: AuthContext;
  id: string;
}): Promise<ItemSpec> {
  const { auth, id } = options;

  const query = `
    query GetSpec($id: String!) {
      spec(id: $id) {
        spec
        lang
        itemId
        coverage { checked missing }
      }
    }
  `;

  const result = await graphqlRequest<{ spec: ItemSpec }>(auth, query, { id });
  return result.spec;
}

export async function updateItem(options: {
  auth: AuthContext;
  id: string;
  name?: string;
  taskId?: string;
  help?: string;
}): Promise<Item> {
  const { auth, id, name, taskId, help } = options;

  const mutation = `
    mutation UpdateItem($id: String!, $name: String, $taskId: String, $help: String) {
      updateItem(id: $id, name: $name, taskId: $taskId, help: $help) {
        id
        name
        taskId
        lang
        help
        isPublic
        created
        updated
        client
      }
    }
  `;

  const result = await graphqlRequest<{ updateItem: Item }>(
    auth,
    mutation,
    { id, name, taskId, help }
  );

  return result.updateItem;
}

// --- Languages (queried from backend) ---

const LANGUAGE_CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const listLanguagesCache = new Map<string, CacheEntry<Language[]>>();
const getLanguageInfoCache = new Map<string, CacheEntry<LanguageInfo | null>>();

export interface Language {
  id: string;
  name: string;
  description: string;
  // The catalog's steering text — including negative gates ("do NOT use for…").
  // Surfaced to agents as `when_to_use` at discovery time; without it the
  // catalog can only pull a language in, never push a wrong pick away.
  routingHint?: string | null;
  domains: string[];
}

export async function listLanguages(options: {
  auth: AuthContext;
  domain?: string;
  search?: string;
}): Promise<Language[]> {
  const { auth, domain, search } = options;

  const cacheKey = `${domain ?? ""}|${search ?? ""}`;
  const cached = listLanguagesCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const query = `
    query ListLanguages($domain: String, $search: String) {
      languages(domain: $domain, search: $search) {
        id
        name
        description
        routingHint
        domains
      }
    }
  `;

  const result = await graphqlRequest<{ languages: Language[] }>(
    auth,
    query,
    { domain, search }
  );

  listLanguagesCache.set(cacheKey, {
    value: result.languages,
    expiresAt: Date.now() + LANGUAGE_CACHE_TTL_MS,
  });

  return result.languages;
}

export interface ExamplePrompt {
  prompt: string;
  produces?: string | null;
  notes?: string | null;
}

export interface LanguageScope {
  summary: string;
  inScope: string[];
  outOfScope: string[];
}

export interface LanguageInfo {
  id: string;
  name: string;
  description: string;
  routingHint?: string | null;
  domains: string[];
  specUrl: string;
  authoringGuide: string | null;
  supportedItemTypes: string[];
  examplePrompts: ExamplePrompt[];
  usageGuide: string | null;
  scope?: LanguageScope | null;
}

export async function getLanguageInfo(options: {
  auth: AuthContext;
  language: string;
}): Promise<LanguageInfo | null> {
  const { auth, language } = options;

  // Normalize language ID (remove "L" prefix if present)
  const langId = language.replace(/^L/i, "");

  const cached = getLanguageInfoCache.get(langId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const query = `
    query GetLanguageInfo($id: String!) {
      language(id: $id) {
        id
        name
        description
        routingHint
        domains
        specUrl
        authoringGuide
        supportedItemTypes
        examplePrompts {
          prompt
          produces
          notes
        }
        usageGuide
        scope {
          summary
          inScope
          outOfScope
        }
      }
    }
  `;

  const result = await graphqlRequest<{ language: LanguageInfo | null }>(
    auth,
    query,
    { id: langId }
  );

  getLanguageInfoCache.set(langId, {
    value: result.language,
    expiresAt: Date.now() + LANGUAGE_CACHE_TTL_MS,
  });

  return result.language;
}

export async function getTemplate(language: string): Promise<string | null> {
  const langId = language.replace(/^L/i, "");
  try {
    const response = await fetch(`${API_URL}/L${langId}/template.gc`);
    if (!response.ok) return null;
    const text = await response.text();
    return text || null;
  } catch {
    return null;
  }
}
