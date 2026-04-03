/**
 * Graffiticode GraphQL API client
 */

const CONSOLE_API_URL = process.env.GRAFFITICODE_CONSOLE_URL || "https://graffiticode.org/api";
const GC_API_URL = process.env.GRAFFITICODE_API_URL || "https://api.graffiticode.org";

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function graphqlRequest<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const response = await fetch(CONSOLE_API_URL, {
    method: "POST",
    headers: {
      "Authorization": token,
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
  description: string;
  language: string;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  errors?: Array<{ message: string }>;
}

export async function generateCode(options: {
  token: string;
  prompt: string;
  language: string;
  currentSrc?: string;
}): Promise<GenerateCodeResult> {
  const { token, prompt, language, currentSrc } = options;

  const query = `
    mutation GenerateCode($prompt: String!, $language: String!, $currentSrc: String) {
      generateCode(prompt: $prompt, language: $language, currentSrc: $currentSrc) {
        src
        taskId
        description
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
    token,
    query,
    { prompt, language, currentSrc }
  );

  return result.generateCode;
}

// --- Get Data ---

export async function getData(options: {
  token: string;
  taskId: string;
}): Promise<unknown> {
  const { token, taskId } = options;

  const query = `
    query GetData($id: String!) {
      data(id: $id)
    }
  `;

  const result = await graphqlRequest<{ data: string }>(
    token,
    query,
    { id: taskId }
  );

  return JSON.parse(result.data);
}

// --- Get Task ---

export async function getTask(options: {
  token: string;
  id: string;
}): Promise<{ id: string; lang: string; code: string; src: string }> {
  const { token, id } = options;

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
    token,
    query,
    { id }
  );

  return result.task;
}

// --- Item CRUD ---

export interface Item {
  id: string;
  name: string | null;
  taskId: string;
  lang: string;
  help: string | null;
  isPublic: boolean;
  created: string;
  updated: string;
  app: string | null;
}

export async function createItem(options: {
  token: string;
  lang: string;
  name?: string;
  taskId?: string;
  help?: string;
  app?: string;
}): Promise<Item> {
  const { token, lang, name, taskId, help, app } = options;

  const mutation = `
    mutation CreateItem($lang: String!, $name: String, $taskId: String, $help: String, $app: String) {
      createItem(lang: $lang, name: $name, taskId: $taskId, help: $help, app: $app) {
        id
        name
        taskId
        lang
        help
        isPublic
        created
        updated
        app
      }
    }
  `;

  const result = await graphqlRequest<{ createItem: Item }>(
    token,
    mutation,
    { lang, name, taskId, help, app }
  );

  return result.createItem;
}

export async function getItem(options: {
  token: string;
  id: string;
}): Promise<Item | null> {
  const { token, id } = options;

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
        app
      }
    }
  `;

  const result = await graphqlRequest<{ item: Item | null }>(
    token,
    query,
    { id }
  );

  return result.item;
}

export async function updateItem(options: {
  token: string;
  id: string;
  name?: string;
  taskId?: string;
  help?: string;
}): Promise<Item> {
  const { token, id, name, taskId, help } = options;

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
        app
      }
    }
  `;

  const result = await graphqlRequest<{ updateItem: Item }>(
    token,
    mutation,
    { id, name, taskId, help }
  );

  return result.updateItem;
}

// --- Languages (queried from backend) ---

export interface Language {
  id: string;
  name: string;
  description: string;
  category?: string;
}

export async function listLanguages(options: {
  token: string;
  category?: string;
  search?: string;
}): Promise<Language[]> {
  const { token, category, search } = options;

  const query = `
    query ListLanguages($category: String, $search: String) {
      languages(category: $category, search: $search) {
        id
        name
        description
        category
      }
    }
  `;

  const result = await graphqlRequest<{ languages: Language[] }>(
    token,
    query,
    { category, search }
  );

  return result.languages;
}

export interface LanguageInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  examples: string[];
  reactComponent: {
    package: string;
    component: string;
    styleImport: string;
  };
  specUrl: string;
}

export async function getLanguageInfo(options: {
  token: string;
  language: string;
}): Promise<LanguageInfo | null> {
  const { token, language } = options;

  // Normalize language ID (remove "L" prefix if present)
  const langId = language.replace(/^L/i, "");

  const query = `
    query GetLanguageInfo($id: String!) {
      language(id: $id) {
        id
        name
        description
        category
        examples
        reactComponent {
          package
          component
          styleImport
        }
        specUrl
      }
    }
  `;

  const result = await graphqlRequest<{ language: LanguageInfo | null }>(
    token,
    query,
    { id: langId }
  );

  return result.language;
}

export async function getTemplate(language: string): Promise<string | null> {
  const langId = language.replace(/^L/i, "");
  try {
    const response = await fetch(`${GC_API_URL}/L${langId}/template.gc`);
    if (!response.ok) return null;
    const text = await response.text();
    return text || null;
  } catch {
    return null;
  }
}
