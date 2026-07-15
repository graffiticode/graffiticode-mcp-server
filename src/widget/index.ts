/**
 * Widget module exports for ChatGPT Apps / Skybridge and Claude MCP Apps integration.
 *
 * One native widget serves both hosts: the browser bundle picks the host adapter
 * at runtime, and the two resources differ only in mimeType and (identical) CSP.
 */
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

export { generateWidgetHtml, widgetBundle, WIDGET_BUNDLE_PATH } from "./widget-html.js";
export { NATIVE_LANGUAGES } from "./languages.js";

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "https://mcp.graffiticode.org";

// ChatGPT / Skybridge resource.
export const WIDGET_MIME_TYPE = "text/html+skybridge";
// Claude / MCP Apps resource. mimeType is the official MCP Apps content type
// (`text/html;profile=mcp-app`) from the ext-apps SDK.
export const CLAUDE_WIDGET_MIME_TYPE = RESOURCE_MIME_TYPE;

/**
 * Widget resource URIs — STABLE (deliberately not content-hashed).
 *
 * These were briefly content-hashed to force stale hosts to re-read. That was a
 * mistake once the template became a thin loader: it renamed the URI on every
 * deploy, so any pointer a host had cached (e.g. ChatGPT's) 404'd — and if the host
 * couldn't refresh its cache (ChatGPT's localStorage is chronically full of its own
 * Statsig data), it was stuck 404ing the old name forever.
 *
 * Stable URIs are safe now BECAUSE the template is a thin loader: the render logic
 * lives in the bundle, fetched by URL with ETag revalidation (and a ?v= bundle-hash
 * cache-buster). So even a forever-cached template re-fetches the current bundle —
 * no stale-replay, and cached pointers always resolve. The names match the
 * pre-refactor URIs so already-cached ChatGPT/Claude pointers keep working.
 */
export function widgetResourceUris(): { openai: string; mcp: string } {
  return {
    openai: "ui://graffiticode/form-widget.html",
    mcp: "ui://graffiticode/claude-form-widget.html",
  };
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
