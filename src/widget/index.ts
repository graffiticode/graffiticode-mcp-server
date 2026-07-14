/**
 * Widget module exports for ChatGPT Apps / Skybridge and Claude MCP Apps integration
 */
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

export { generateFormWidgetHtml } from "./form-widget.js";
export { generateClaudeWidgetHtml } from "./claude-widget.js";
export { generateSpikeWidgetHtml } from "./spike-widget.js";

// SPIKE (temporary): when WIDGET_SPIKE=1 the widget resources serve the loading
// probe instead of the real widget, so it exercises the real per-host pointer
// plumbing. Its CSP declares only `resourceDomains` — the origin serving the
// per-language bundles — and deliberately NO frameDomains, which is the posture
// the native widget will ship with.
export const SPIKE_ENABLED = process.env.WIDGET_SPIKE === "1";

export function spikeCsp(origin: string) {
  return {
    // connectDomains is here only so the probe can beacon its findings back to the
    // server (see /spike/report) — the host renders the widget in an opaque sandbox
    // we cannot open devtools on, so a beacon is the only way to see what it sees.
    // The SHIPPING widget needs no connectDomains at all.
    camel: { resourceDomains: [origin], connectDomains: [origin] },
    snake: { resource_domains: [origin], connect_domains: [origin] },
  };
}

// ChatGPT / Skybridge widget constants
export const WIDGET_RESOURCE_URI = "ui://graffiticode/form-widget.html";
export const WIDGET_MIME_TYPE = "text/html+skybridge";

// Claude MCP Apps widget constants. The mimeType is the official MCP Apps
// content type (`text/html;profile=mcp-app`) from the ext-apps SDK.
export const CLAUDE_WIDGET_RESOURCE_URI = "ui://graffiticode/claude-form-widget.html";
export const CLAUDE_WIDGET_MIME_TYPE = RESOURCE_MIME_TYPE;

// Hosts the widget embeds in its iframe. The widget's iframe loads the API
// host's /form endpoint, which 302-redirects to the per-language renderer host
// — that redirect target must be in frame-src too or the navigation is blocked
// ("This content is blocked" / ERR_BLOCKED_BY_CSP). The renderer is served at a
// per-language custom domain `l<NNNN>.graffiticode.org` (e.g. l0158, l0166), so
// it's matched with the `*.graffiticode.org` wildcard. The Cloud Run host is
// kept as a fallback for languages still served directly off run.app.
//   - *.graffiticode.org     api/app + the l<NNNN> language renderer redirect target
//   - *.us-central1.run.app  fallback language renderer host
const WIDGET_FRAME_HOSTS = [
  "*.graffiticode.org",
  "api.graffiticode.org",
  "app.graffiticode.org",
  "*.us-central1.run.app",
];

// CSP for the ChatGPT / Skybridge resource (`openai/widgetCSP`, snake_case).
// ChatGPT requires full origins *with scheme* (e.g. `https://api.graffiticode.org`,
// `https://*.graffiticode.org`) — bare hosts are not parsed, so the widget can't
// frame the /form iframe and ChatGPT shows "This content is blocked". Mirror the
// scheme-prefixed form used by CLAUDE_WIDGET_CSP below.
export const WIDGET_CSP = {
  frame_domains: WIDGET_FRAME_HOSTS.map((h) => `https://${h}`),
  connect_domains: WIDGET_FRAME_HOSTS.map((h) => `https://${h}`),
};

// CSP for the MCP Apps resource (`_meta.ui.csp`, camelCase). frameDomains maps
// to frame-src so the host allows the embedded /form iframe.
export const CLAUDE_WIDGET_CSP = {
  frameDomains: WIDGET_FRAME_HOSTS.map((h) => `https://${h}`),
  connectDomains: WIDGET_FRAME_HOSTS.map((h) => `https://${h}`),
};
