/**
 * Widget module exports for ChatGPT Apps / Skybridge and Claude MCP Apps integration.
 *
 * One native widget serves both hosts: the browser bundle picks the host adapter
 * at runtime, and the two resources differ only in mimeType and (identical) CSP.
 */
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { widgetContentHash } from "./widget-html.js";

export { generateWidgetHtml, widgetContentHash, widgetBundle, WIDGET_BUNDLE_PATH } from "./widget-html.js";
export { NATIVE_LANGUAGES } from "./languages.js";

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "https://mcp.graffiticode.org";

// ChatGPT / Skybridge resource.
export const WIDGET_MIME_TYPE = "text/html+skybridge";
// Claude / MCP Apps resource. mimeType is the official MCP Apps content type
// (`text/html;profile=mcp-app`) from the ext-apps SDK.
export const CLAUDE_WIDGET_MIME_TYPE = RESOURCE_MIME_TYPE;

/**
 * Widget resource URIs, content-hashed.
 *
 * The host caches a widget by its resource URI (the spike proved this the hard
 * way — a stable URI made Claude replay a stale build across every redeploy). So
 * the served HTML's hash is baked into the URI: any change mints a new URI and the
 * host must re-read. Two URIs because the two hosts need different mimeTypes.
 */
let cachedUris: { openai: string; mcp: string } | null = null;

export function widgetResourceUris(): { openai: string; mcp: string } {
  if (!cachedUris) {
    const h = widgetContentHash(MCP_SERVER_URL);
    cachedUris = {
      openai: `ui://graffiticode/widget-oai.${h}.html`,
      mcp: `ui://graffiticode/widget-mcp.${h}.html`,
    };
  }
  return cachedUris;
}

/**
 * Widget CSP — the native widget loads per-language bundles from our own origin
 * and makes no other network calls (formula/chart evaluation is client-side), so
 * `resourceDomains` is the ONLY directive it needs. Crucially, NO `frameDomains`:
 * declaring it is what draws OpenAI's "extra manual review / often not approved
 * for broad distribution" flag, and Claude verified our origin in `resourceDomains`
 * reaches `script-src`, which is all the bundle import needs.
 */
export function widgetCsp(): { camel: Record<string, string[]>; snake: Record<string, string[]> } {
  return {
    camel: { resourceDomains: [MCP_SERVER_URL] },
    snake: { resource_domains: [MCP_SERVER_URL] },
  };
}
