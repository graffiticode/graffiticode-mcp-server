/**
 * Bundle the widget browser entries.
 *
 * Two kinds of output:
 *
 * 1. `dist/widget/claude-app.bundle.js` — the MCP Apps widget entry
 *    (`src/widget/browser/claude-app.ts`), a self-contained IIFE inlined into the
 *    resource HTML by `generateClaudeWidgetHtml()`. tsc does not compile it (it
 *    needs DOM libs and must be a browser bundle).
 *
 * 2. `dist/widget/lang/<id>.mjs` — one ES module per natively-renderable language
 *    (see `src/widget/languages.ts`), served over HTTP and loaded by the widget at
 *    render time. Each bundle owns its React copy and exposes a uniform API:
 *
 *      export const styles: string              // the component's CSS
 *      export function mount(el, data): void    // render the item into `el`
 *
 *    That seam keeps the widget language-agnostic — it never imports React, and
 *    per-language quirks (differing `Form` props, reducers) are absorbed here.
 *    React is bundled IN, not externalized: a bare `react` specifier in a
 *    standalone module is unresolvable in a browser without an import map.
 *
 * Runs after `tsc` as part of `npm run build` (it reads the compiled registry).
 */
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";

let NATIVE_LANGUAGES;
try {
  ({ NATIVE_LANGUAGES } = await import("../dist/widget/languages.js"));
} catch (err) {
  console.error(
    "Could not load the compiled language registry from dist/widget/languages.js.\n" +
      'Run "tsc" first (npm run build does this).'
  );
  throw err;
}

const SHARED = {
  bundle: true,
  platform: "browser",
  target: ["chrome100", "firefox100", "safari15"],
  minify: true,
  legalComments: "none",
};

// The MCP Apps widget entry.
await build({
  ...SHARED,
  entryPoints: ["src/widget/browser/claude-app.ts"],
  outfile: "dist/widget/claude-app.bundle.js",
  format: "iife",
});
console.log("Bundled dist/widget/claude-app.bundle.js");

// The loading spike (temporary; served only when WIDGET_SPIKE=1).
await build({
  ...SHARED,
  entryPoints: ["src/widget/browser/spike.ts"],
  outfile: "dist/widget/spike.bundle.js",
  format: "iife",
});
console.log("Bundled dist/widget/spike.bundle.js");

/**
 * The per-language entry, generated in memory.
 *
 * `createState` is reproduced here rather than imported: the language packages
 * export only `Form`/`View` (the store lives in their un-exported `lib/lib/state.js`).
 * The reducer is likewise not exported — it is defined inside each package's
 * `view.jsx`, the network shell we are deliberately not using. The generic reducer
 * below is sufficient to RENDER any item; language-specific edit semantics (e.g.
 * l0166 merging `args.cells` into `interaction.cells`) are NOT reproduced, so
 * in-widget edits will not persist until the packages export their reducer.
 * See the upstream task.
 */
function entrySource(pkg) {
  return `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Form } from ${JSON.stringify(pkg)};
import css from ${JSON.stringify(pkg + "/style.css")};

const createState = (data, reducer) => {
  let errors = [];
  return {
    apply(action) { data = reducer(data, action); },
    setErrors(next) { errors = Array.isArray(next) ? next : []; },
    get data() { return data; },
    get errors() { return errors; },
  };
};

const reducer = (data, { type, args }) => {
  switch (type) {
    case "init": return { ...args };
    default: return { ...data, ...args };
  }
};

export const styles = css;

export function mount(el, data) {
  const state = createState(data ?? {}, reducer);
  createRoot(el).render(createElement(Form, { state }));
}
`;
}

await mkdir("dist/widget/lang", { recursive: true });

await Promise.all(
  NATIVE_LANGUAGES.flatMap(({ id, pkg }) => {
    const stdin = {
      contents: entrySource(pkg),
      resolveDir: process.cwd(),
      sourcefile: `${id}-entry.js`,
      loader: "js",
    };
    const common = {
      ...SHARED,
      stdin,
      loader: { ".css": "text" },
      define: { "process.env.NODE_ENV": '"production"' },
    };
    return [
      // ESM, for `await import(url)`.
      build({ ...common, outfile: `dist/widget/lang/${id}.mjs`, format: "esm" }).then(() =>
        console.log(`Bundled dist/widget/lang/${id}.mjs`)
      ),
      // IIFE exposing a global, for the classic-<script> fallback. A classic
      // script cannot load the ESM build (a bare `export` is a syntax error), so
      // the fallback path needs its own artifact. Cheap insurance: if a host turns
      // out to block dynamic import(), this is the proven path (cf. ext-apps
      // map-server, which injects a classic script at runtime).
      build({
        ...common,
        outfile: `dist/widget/lang/${id}.iife.js`,
        format: "iife",
        globalName: `GC_${id}`,
      }).then(() => console.log(`Bundled dist/widget/lang/${id}.iife.js`)),
    ];
  })
);
