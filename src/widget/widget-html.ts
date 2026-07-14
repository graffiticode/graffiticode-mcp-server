/**
 * The shared widget HTML — one document for both hosts.
 *
 * The interactive logic is `browser/entry.ts`, bundled to a single IIFE by
 * scripts/build-widget.mjs and inlined here. The bundle picks the host adapter at
 * runtime, so the same HTML serves Claude (MCP Apps) and ChatGPT (Skybridge); the
 * two resources differ only in mimeType and CSP, set in the resource envelope.
 *
 * `__MCP_ORIGIN__` (bundle origin, must match the CSP resourceDomains) and
 * `__NATIVE__` (languages with a native bundle) are injected here.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { NATIVE_LANGUAGES } from "./languages.js";

const BUNDLE_URL = new URL("./widget.bundle.js", import.meta.url);

let cachedScript: string | null = null;

function loadBundle(): string {
  if (cachedScript === null) {
    try {
      cachedScript = readFileSync(fileURLToPath(BUNDLE_URL), "utf8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Widget bundle not found at ${BUNDLE_URL.href}. Run "npm run build". (${message})`
      );
    }
  }
  return cachedScript;
}

const STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #fff; color: #111827; padding: 4px; }
  body.dark { background: #1f2937; color: #f9fafb; }
  #content.loading { display: flex; align-items: center; justify-content: center; height: 160px; color: #6b7280; }
  .error { padding: 20px; color: #dc2626; background: #fef2f2; border-radius: 8px; text-align: center; }
  body.dark .error { color: #fca5a5; background: #450a0a; }
  .card { padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px; background: #f9fafb; }
  body.dark .card { border-color: #374151; background: #111827; }
  .card-title { font-size: 16px; font-weight: 600; }
  .card-text { margin-top: 6px; font-size: 14px; color: #6b7280; }
  body.dark .card-text { color: #9ca3af; }
  .card-body { margin-top: 12px; }
  .card-actions { margin-top: 18px; }
  .card-pre { margin-top: 10px; padding: 10px; font-size: 12px; white-space: pre-wrap; overflow-x: auto;
    background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; max-height: 320px; overflow-y: auto; }
  body.dark .card-pre { background: #0b1220; border-color: #374151; }
  .q-list { margin-top: 10px; padding-left: 18px; display: flex; flex-direction: column; gap: 10px; }
  .q-stim { font-weight: 500; }
  .q-opts { margin-top: 4px; padding-left: 16px; list-style: none; }
  .q-opts li { font-size: 13px; color: #6b7280; }
  .q-opts li.correct { color: #15803d; font-weight: 600; }
  body.dark .q-opts li.correct { color: #4ade80; }
  .btn { font: inherit; font-weight: 600; cursor: pointer; padding: 10px 18px; border: none; border-radius: 8px; color: #fff; background: #2563eb; }
  .btn:hover { background: #1d4ed8; }
  .footer-link { display: block; width: 100%; margin-top: 10px; font: inherit; font-size: 13px; cursor: pointer;
    padding: 6px; border: none; background: none; color: #2563eb; text-align: center; }
  .footer-link:hover { text-decoration: underline; }
  body.dark .footer-link { color: #60a5fa; }
`;

/** @param origin absolute origin serving /widget/lang/*.mjs (must match CSP resourceDomains) */
export function generateWidgetHtml(origin: string): string {
  const script = loadBundle();
  const native = JSON.stringify(NATIVE_LANGUAGES.map((l) => l.id));
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>${STYLES}</style>
</head>
<body>
  <div id="content" class="loading">Loading…</div>
  <script>
    window.__MCP_ORIGIN__ = ${JSON.stringify(origin)};
    window.__NATIVE__ = ${native};
  </script>
  <script>${script}</script>
</body>
</html>`;
}

/** The resource URI is the host's cache key (the spike proved this the hard way),
 * so hash the served HTML into it: any change to the widget mints a new URI and
 * the host is forced to re-read instead of replaying a stale build. */
export function widgetContentHash(origin: string): string {
  return createHash("sha256").update(generateWidgetHtml(origin)).digest("hex").slice(0, 8);
}
