/**
 * Bundle the MCP Apps widget browser entry into a single IIFE.
 *
 * `src/widget/browser/claude-app.ts` imports the ext-apps `App` class and runs
 * in the host's sandboxed iframe. tsc does not compile it (it needs DOM libs and
 * must be a self-contained browser bundle); esbuild bundles it and its deps into
 * `dist/widget/claude-app.bundle.js`, which `generateClaudeWidgetHtml()` inlines
 * into the resource HTML at runtime.
 *
 * Runs after `tsc` as part of `npm run build`.
 */
import { build } from "esbuild";

await build({
  entryPoints: ["src/widget/browser/claude-app.ts"],
  outfile: "dist/widget/claude-app.bundle.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome100", "firefox100", "safari15"],
  minify: true,
  legalComments: "none",
});

console.log("Bundled dist/widget/claude-app.bundle.js");
