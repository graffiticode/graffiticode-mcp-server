/**
 * MCP resource handlers shared by stdio (index.ts) and hosted (server.ts) modes.
 *
 * Exposes each Graffiticode language's full user-guide markdown as a
 * per-language resource URI. The inline envelope returned by
 * get_language_info is typically enough for authoring; clients fetch the
 * full guide through ReadResource for deeper reference.
 */

import { getLanguageInfo } from "./api.js";

export const USER_GUIDE_URI_TEMPLATE = "graffiticode://language/{id}/user-guide";
export const USER_GUIDE_MIME_TYPE = "text/markdown";

export const userGuideResourceTemplate = {
  uriTemplate: USER_GUIDE_URI_TEMPLATE,
  name: "Graffiticode Language User Guide",
  description:
    "Agent-facing authoring guide (markdown) for a Graffiticode language. " +
    "Substitute {id} with a language ID like L0158.",
  mimeType: USER_GUIDE_MIME_TYPE,
};

const USER_GUIDE_URI_PATTERN = /^graffiticode:\/\/language\/L(\d+)\/user-guide$/i;

export function matchUserGuideUri(uri: string): string | null {
  const match = uri.match(USER_GUIDE_URI_PATTERN);
  return match ? match[1] : null;
}

export async function readUserGuideResource(options: {
  token: string;
  uri: string;
  langId: string;
}): Promise<{ uri: string; mimeType: string; text: string }> {
  const { token, uri, langId } = options;
  const info = await getLanguageInfo({ token, language: langId });
  if (!info) {
    throw new Error(`Language not found: L${langId}`);
  }
  return {
    uri,
    mimeType: USER_GUIDE_MIME_TYPE,
    text: info.userGuide ?? "",
  };
}
