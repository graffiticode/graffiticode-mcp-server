/**
 * Bundle the widget browser entry.
 *
 * Output: `dist/widget/widget.bundle.js` — the widget entry (`src/widget/browser/entry.ts`),
 * a self-contained IIFE inlined into the resource HTML by `generateWidgetHtml()`.
 * It picks the host adapter (ext-apps / window.openai) at runtime, so one bundle
 * serves both hosts.
 *
 * The bundle is small: React, the ext-apps `App`, and every language `Form` are
 * loaded at render time via dynamic `import()` of full esm.sh URLs — NOT bundled.
 * esm.sh is the only remote script origin ChatGPT's widget sandbox allows (its
 * script-src is a fixed CDN allowlist that ignores our origin); Claude allows it via
 * resourceDomains. One loading path, both hosts. The `?deps` pin in the esm.sh URLs
 * (see languages.ts) keeps React a single instance so component hooks work.
 *
 * tsc does not compile browser/*.ts (they need DOM libs and must be a browser bundle).
 * Runs after `tsc` as part of `npm run build`.
 */
import { build } from "esbuild";

await build({
  bundle: true,
  platform: "browser",
  target: ["chrome100", "firefox100", "safari15"],
  minify: true,
  legalComments: "none",
  entryPoints: ["src/widget/browser/entry.ts"],
  outfile: "dist/widget/widget.bundle.js",
  format: "iife",
});
console.log("Bundled dist/widget/widget.bundle.js");
