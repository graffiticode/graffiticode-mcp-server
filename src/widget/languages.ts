/**
 * The language registry: the single source of truth for which languages the
 * widget renders natively.
 *
 * Consumed by both `scripts/build-widget.mjs` (which bundles one ESM module per
 * native language into `dist/widget/lang/<id>.mjs`) and the runtime handlers in
 * `server.ts` that serve those bundles.
 *
 * npm is the source of truth for component versions: `pkg` is resolved from
 * node_modules at build time and the version is pinned in package.json. Shipping
 * a language upgrade is `npm update <pkg>` → rebuild → deploy, so it passes a
 * build before it reaches users. Adding a language is: `npm i -D <pkg>`, then one
 * entry here.
 */

export interface NativeLanguage {
  /** Canonical language id, e.g. "L0166". */
  id: string;
  /** npm package exporting the presentational `Form` component. */
  pkg: string;
}

/**
 * Every language the catalog lists renders natively. There is no "non-renderable"
 * tier: each language ships a React `Form` view, so if `list_languages` returns it,
 * it belongs here. A listed language with no entry silently degrades to the content
 * card, which reads as a broken render rather than a deliberate one.
 *
 * This replaces an earlier `NON_RENDERABLE_LANGUAGES` set that exempted
 * L0158/L0176/L0177/L0170 on the theory that vendor-script, spec-emitting and
 * data-provider languages had nothing to show. They do — each has a `Form` in its
 * repo's `packages/view`. That set was also never imported anywhere, so it
 * documented a policy the code did not implement.
 *
 * The props contract is uniform across all of these: each package exports
 * `Form: ({ state })` (the `FormProps` from `@graffiticode/l0000-view`) plus a
 * `./style.css` subpath, which is exactly what `entrySource()` in
 * `scripts/build-widget.mjs` generates against.
 *
 * VERIFICATION DEBT: the eight added 2026-09-01 build, but none has been seen
 * rendering a real item by a person. That is the bar this file previously set, after
 * L0169 was added on the strength of a clean build and then did NOT mount in
 * production — it fell through to the content card, having paid for a 0.3MB bundle
 * and the empty-mount grace period first. jsdom does not clear that bar either: it
 * cannot render L0173 at all, so a failure there proves nothing. Treat every entry
 * after L0179 below as unverified until someone has watched it render.
 */
export const NATIVE_LANGUAGES: NativeLanguage[] = [
  { id: "L0166", pkg: "@graffiticode/l0166" },
  // L0173 renders charts; L0179 supersedes L0166 and needed its own bundle, since
  // the DEPRECATED dialect rendered natively while its live replacement fell back
  // to a static preview — the wrong way round for the language 8 of 17 recent
  // items were authored in. Same `({ state })` Form contract as l0166.
  { id: "L0173", pkg: "@graffiticode/l0173" },
  { id: "L0179", pkg: "@graffiticode/l0179-view" },

  // Added 2026-09-01. The first three were on npm already; the five `-view`
  // packages were built in their own repos but had never been pushed, which was
  // the only thing blocking them.
  { id: "L0159", pkg: "@graffiticode/l0159" },
  // L0169 is the known-bad one: added and reverted 2026-08-31 because it did not
  // mount in production. Nothing about it has been fixed since — it is here because
  // the catalog lists it, and it is the first entry that should be checked by hand.
  { id: "L0169", pkg: "@graffiticode/l0169" },
  { id: "L0170", pkg: "@graffiticode/l0170" },
  // L0175 has a published base package too (`@graffiticode/l0175`), but that one is
  // the COMPILER: no `Form`, no `style.css`, so pointing at it fails the build. The
  // view is always the `-view` package, as with L0179.
  { id: "L0175", pkg: "@graffiticode/l0175-view" },
  { id: "L0176", pkg: "@graffiticode/l0176-view" },
  { id: "L0177", pkg: "@graffiticode/l0177-view" },
  { id: "L0178", pkg: "@graffiticode/l0178-view" },
  { id: "L0180", pkg: "@graffiticode/l0180-view" },
];

/** Normalize `0166` / `l0166` / `L0166` to `L0166`. */
export function normalizeLanguageId(lang: string): string {
  const digits = lang.replace(/^[lL]/, "");
  return `L${digits}`;
}

export function isNativeLanguage(lang: string): boolean {
  const id = normalizeLanguageId(lang);
  return NATIVE_LANGUAGES.some((l) => l.id === id);
}
