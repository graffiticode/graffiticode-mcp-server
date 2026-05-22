/**
 * MCP Apps widget entry (browser) for Graffiticode forms.
 *
 * Runs inside the host's sandboxed iframe. Uses the official ext-apps `App`
 * class, which performs the JSON-RPC `ui/initialize` handshake over
 * postMessage, delivers the tool result via `ontoolresult`, surfaces host
 * context (theme), and auto-reports size changes to the host.
 *
 * This file is NOT compiled by `tsc` (excluded in tsconfig). It is bundled to a
 * single IIFE by `scripts/build-widget.mjs` and inlined into the resource HTML
 * by `generateClaudeWidgetHtml()`.
 */
import { App } from "@modelcontextprotocol/ext-apps";

const contentEl = document.getElementById("content");
let rendered = false;

function setError(message: string): void {
  if (!contentEl) return;
  contentEl.className = "error";
  contentEl.textContent = message;
}

function applyTheme(theme?: string): void {
  document.body.classList.toggle("dark", theme === "dark");
}

// Tool result params carry `_meta` (widget-only) and `structuredContent`.
function render(params: {
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  isError?: boolean;
}): void {
  if (rendered || !contentEl) return;

  const meta = params._meta ?? {};
  const formUrl = typeof meta.form_url === "string" ? meta.form_url : undefined;
  if (!formUrl) {
    setError("Unable to load form. Missing form URL.");
    return;
  }

  rendered = true;
  const iframe = document.createElement("iframe");
  iframe.src = formUrl;
  iframe.allow = "clipboard-read; clipboard-write";
  contentEl.className = "";
  contentEl.replaceChildren(iframe);
}

const app = new App({ name: "graffiticode-form", version: "1.0.0" });

// Register handlers before connecting so no early notifications are missed.
app.ontoolresult = (params) => render(params);
app.onhostcontextchanged = (ctx) => applyTheme(ctx.theme);

app
  .connect()
  .then(() => applyTheme(app.getHostContext()?.theme))
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    setError("Failed to connect to host: " + message);
  });
