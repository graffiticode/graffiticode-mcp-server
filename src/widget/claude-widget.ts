/**
 * Claude / MCP Apps widget HTML generator for Graffiticode forms.
 *
 * Returns a single self-contained HTML document served as the
 * `text/html;profile=mcp-app` resource. The interactive logic lives in
 * `browser/claude-app.ts`, bundled to a single IIFE by
 * `scripts/build-widget.mjs` (run as part of `npm run build`) and inlined here.
 *
 * The bundled script uses the ext-apps `App` class to talk to the host over the
 * standard MCP Apps JSON-RPC/postMessage bridge, reads `_meta.form_url` from the
 * tool result, and embeds the rendered form in an iframe.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Resolved relative to the compiled module (dist/widget/claude-widget.js); the
// esbuild step writes the bundle next to it at dist/widget/claude-app.bundle.js.
const BUNDLE_URL = new URL("./claude-app.bundle.js", import.meta.url);

let cachedScript: string | null = null;

function loadBundle(): string {
  if (cachedScript === null) {
    try {
      cachedScript = readFileSync(fileURLToPath(BUNDLE_URL), "utf8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Claude widget bundle not found at ${BUNDLE_URL.href}. ` +
          `Run "npm run build" to generate it. (${message})`
      );
    }
  }
  return cachedScript;
}

export function generateClaudeWidgetHtml(): string {
  const script = loadBundle();
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #fff; }
    body.dark { background: #1f2937; color: #f9fafb; }
    .container { width: 100%; height: 100%; }
    iframe { width: 100%; height: 600px; border: none; border-radius: 8px; }
    .error {
      padding: 20px;
      color: #dc2626;
      background: #fef2f2;
      border-radius: 8px;
      text-align: center;
    }
    body.dark .error { color: #fca5a5; background: #450a0a; }
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 200px;
      color: #6b7280;
    }
    body.dark .loading { color: #9ca3af; }
    .card {
      padding: 28px 24px;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      text-align: center;
      background: #f9fafb;
    }
    body.dark .card { border-color: #374151; background: #111827; }
    .card-title { font-size: 16px; font-weight: 600; color: #111827; }
    body.dark .card-title { color: #f9fafb; }
    .card-text { margin-top: 6px; font-size: 14px; color: #6b7280; }
    body.dark .card-text { color: #9ca3af; }
    .card-actions { margin-top: 18px; }
    .btn {
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      padding: 10px 18px;
      border: none;
      border-radius: 8px;
      color: #fff;
      background: #2563eb;
    }
    .btn:hover { background: #1d4ed8; }
    .footer-link {
      display: block;
      width: 100%;
      margin-top: 8px;
      font: inherit;
      font-size: 13px;
      cursor: pointer;
      padding: 6px;
      border: none;
      background: none;
      color: #2563eb;
      text-align: center;
    }
    .footer-link:hover { text-decoration: underline; }
    body.dark .footer-link { color: #60a5fa; }
  </style>
</head>
<body>
  <div class="container">
    <div id="content" class="loading">Loading form...</div>
  </div>
  <script>${script}</script>
</body>
</html>`;
}
