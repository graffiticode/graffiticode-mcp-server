/**
 * Bundle the widget browser entries.
 *
 * Two kinds of output:
 *
 * 1. `dist/widget/widget.bundle.js` — the widget entry (`src/widget/browser/entry.ts`),
 *    a self-contained IIFE inlined into the resource HTML by `generateWidgetHtml()`.
 *    It picks the host adapter (ext-apps / window.openai) at runtime, so one bundle
 *    serves both hosts. tsc does not compile browser/*.ts (they need DOM libs and
 *    must be a browser bundle).
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

// The unified widget entry (both hosts; picks the adapter at runtime).
await build({
  ...SHARED,
  entryPoints: ["src/widget/browser/entry.ts"],
  outfile: "dist/widget/widget.bundle.js",
  format: "iife",
});
console.log("Bundled dist/widget/widget.bundle.js");

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
 *
 * `unwrapEnvelope` mirrors the package's `View`: the item's `data(id)` payload is an
 * envelope `{ data, errors }`, and Form expects the UNWRAPPED inner data. Without
 * this, Form receives the envelope, sees no `type`/`interaction`, and renders raw
 * JSON instead of the chart/spreadsheet.
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

// Same shape check the package's View uses (view.jsx unwrapEnvelope).
function unwrapEnvelope(resp) {
  if (resp && typeof resp === "object" && !Array.isArray(resp) && ("data" in resp || "errors" in resp)) {
    return { data: resp.data, errors: Array.isArray(resp.errors) ? resp.errors : [] };
  }
  return { data: resp, errors: [] };
}

export const styles = css;

export function mount(el, raw) {
  const { data, errors } = unwrapEnvelope(raw);
  const state = createState(data ?? {}, reducer);
  state.setErrors(errors);
  createRoot(el).render(createElement(Form, { state }));
}
`;
}

await mkdir("dist/widget/lang", { recursive: true });

await Promise.all(
  NATIVE_LANGUAGES.map(({ id, pkg }) =>
    build({
      ...SHARED,
      stdin: {
        contents: entrySource(pkg),
        resolveDir: process.cwd(),
        sourcefile: `${id}-entry.js`,
        loader: "js",
      },
      outfile: `dist/widget/lang/${id}.mjs`,
      format: "esm",
      loader: { ".css": "text" },
      define: { "process.env.NODE_ENV": '"production"' },
    }).then(() => console.log(`Bundled dist/widget/lang/${id}.mjs`))
  )
);
