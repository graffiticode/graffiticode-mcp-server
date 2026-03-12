/**
 * Widget module exports for ChatGPT Apps / Skybridge and Claude MCP Apps integration
 */

export { generateFormWidgetHtml } from "./form-widget.js";
export { generateClaudeWidgetHtml } from "./claude-widget.js";

// ChatGPT / Skybridge widget constants
export const WIDGET_RESOURCE_URI = "ui://graffiticode/form-widget.html";
export const WIDGET_MIME_TYPE = "text/html+skybridge";

// Claude MCP Apps widget constants
export const CLAUDE_WIDGET_RESOURCE_URI = "ui://graffiticode/claude-form-widget.html";
export const CLAUDE_WIDGET_MIME_TYPE = "text/html;profile=mcp-app";

// Content Security Policy for the widget
// Allows the widget to embed iframes from api.graffiticode.org
export const WIDGET_CSP = {
  frame_domains: ["api.graffiticode.org"],
  connect_domains: ["api.graffiticode.org"],
};
