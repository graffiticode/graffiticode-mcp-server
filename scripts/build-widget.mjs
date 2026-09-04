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
import { fileURLToPath } from "node:url";

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

/**
 * Force ONE React into every language bundle.
 *
 * The language packages declare `react`/`react-dom` as direct DEPENDENCIES
 * rather than peers — all of l0151/0154/0155/0159/0169/0170/0172 and
 * l0179-view do. npm is then free to nest a private copy under the package,
 * and esbuild faithfully bundles both, at which point hooks resolve against a
 * null dispatcher and mounting dies with
 * `Cannot read properties of null (reading 'useState')`. L0169 failed exactly
 * this way; L0179 escaped it only because npm happened to hoist its copy, which
 * is luck rather than a guarantee — the same install on a different day can
 * nest it.
 *
 * Aliasing at bundle time fixes every package at once and keeps working when a
 * new one is added, without waiting on eight republishes to move react to
 * peerDependencies. That is still the right fix in the packages; this makes the
 * build correct meanwhile, and harmless afterwards.
 *
 * react-dom/client is listed explicitly: esbuild aliases a bare specifier, and
 * the entry template imports the subpath.
 */
const reactPath = (spec) => fileURLToPath(import.meta.resolve(spec));
const REACT_ALIAS = {
  react: reactPath("react"),
  "react-dom": reactPath("react-dom"),
  "react-dom/client": reactPath("react-dom/client"),
  "react/jsx-runtime": reactPath("react/jsx-runtime"),
};

const SHARED = {
  bundle: true,
  platform: "browser",
  target: ["chrome100", "firefox100", "safari15"],
  minify: true,
  legalComments: "none",
  alias: REACT_ALIAS,
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
 * The state store is reproduced here rather than imported: the language packages
 * export only `Form`/`View`, and `View` is the network shell we are deliberately
 * not using (it reads `?id=`/`?access_token=` off the URL and round-trips
 * `/compile`). What we DO have to reproduce faithfully is the half of `View` that
 * is not networking: `state.apply` is a React `useReducer` dispatch, so applying an
 * action re-renders the Form.
 *
 * That is load-bearing, not incidental. Every `Form` in the family is CONTROLLED —
 * l0180 keeps the candidate's answer in `state.data.response` and renders ✓/✗ and
 * "Correct — 1 / 1 points" from `data.response` + `data.validation` on the next
 * render. An `apply` that mutates a closure and notifies nobody (what this built
 * before) leaves the component holding its first render forever: a click selects
 * nothing, and no assessment ever scores. It looked like a missing feature and was
 * a missing `setState`.
 *
 * Language-specific edit semantics (e.g. l0166 merging `args.cells` into
 * `interaction.cells`) are still NOT reproduced — those live in each package's
 * un-exported `view.jsx` reducer. Neither is the `/compile` round trip `View`
 * performs on `update`/`response`, which is what re-derives server-computed data
 * (l0166 formula results); the widget's CSP declares no `connectDomains`, so any
 * language whose feedback is computed upstream rather than in the browser still
 * renders inertly. l0180 is not one of those: it ships its own scorer.
 *
 * `unwrapEnvelope` mirrors the package's `View`: the item's `data(id)` payload is an
 * envelope `{ data, errors }`, and Form expects the UNWRAPPED inner data. Without
 * this, Form receives the envelope, sees no `type`/`interaction`, and renders raw
 * JSON instead of the chart/spreadsheet.
 */
function entrySource(pkg) {
  return `
import { createElement, useMemo, useReducer } from "react";
import { createRoot } from "react-dom/client";
import { Form } from ${JSON.stringify(pkg)};
import css from ${JSON.stringify(pkg + "/style.css")};

// The generic half of l0000-view's reducer. \`focus\` is a named field rather than a
// merge; every other action merges. Unknown types merge too — l0000 logs and drops
// them, but a dropped action here is a click that does nothing, and merging is the
// behaviour this build already had for them.
const reducer = (data, { type, args }) => {
  switch (type) {
    case "init": return { ...args };
    case "focus": return { ...data, focus: args };
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

// \`apply\` is the useReducer dispatch, exactly as in l0000-view's View — that is what
// makes the controlled Forms re-render, and with them score.
function Root({ initialData, errors }) {
  const [data, apply] = useReducer(reducer, initialData);
  const state = useMemo(() => ({ data, errors, apply }), [data, errors]);
  return createElement(Form, { state });
}

export const styles = css;

export function mount(el, raw) {
  const { data, errors } = unwrapEnvelope(raw);
  createRoot(el).render(createElement(Root, { initialData: data ?? {}, errors }));
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
