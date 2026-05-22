/**
 * Widget module exports for ChatGPT Apps / Skybridge and Claude MCP Apps integration
 */
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

export { generateFormWidgetHtml } from "./form-widget.js";
export { generateClaudeWidgetHtml } from "./claude-widget.js";

// ChatGPT / Skybridge widget constants
export const WIDGET_RESOURCE_URI = "ui://graffiticode/form-widget.html";
export const WIDGET_MIME_TYPE = "text/html+skybridge";

// Claude MCP Apps widget constants. The mimeType is the official MCP Apps
// content type (`text/html;profile=mcp-app`) from the ext-apps SDK.
export const CLAUDE_WIDGET_RESOURCE_URI = "ui://graffiticode/claude-form-widget.html";
export const CLAUDE_WIDGET_MIME_TYPE = RESOURCE_MIME_TYPE;

// Hosts the widget embeds in its iframe: the API host (token-authenticated
// /form for signed-in users) and the app host (public view page for trials).
const WIDGET_FRAME_HOSTS = ["api.graffiticode.org", "app.graffiticode.org"];

// CSP for the ChatGPT / Skybridge resource (`openai/widgetCSP`, snake_case).
export const WIDGET_CSP = {
  frame_domains: WIDGET_FRAME_HOSTS,
  connect_domains: WIDGET_FRAME_HOSTS,
};

// CSP for the MCP Apps resource (`_meta.ui.csp`, camelCase). frameDomains maps
// to frame-src so the host allows the embedded /form iframe.
export const CLAUDE_WIDGET_CSP = {
  frameDomains: WIDGET_FRAME_HOSTS.map((h) => `https://${h}`),
  connectDomains: WIDGET_FRAME_HOSTS.map((h) => `https://${h}`),
};
