/**
 * The language registry: the single source of truth for which languages the
 * widget can render natively, and which fall back to a content card.
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
 * Languages whose npm package exports a `Form` that renders purely from the
 * item's `data` — no network, no vendor script. These get a native bundle.
 *
 * Adding one is a one-line entry, but check its `Form` signature first: the
 * props contract is NOT uniform across packages (l0166 is `({state})`, l0158 is
 * `({state, targetOrigin})`).
 */
/**
 * Six more languages (L0169/L0159/L0170/L0172/L0154/L0155) were added here on
 * 2026-08-31 and taken back out the same day. Their packages are published and
 * export the right Form, and the bundles build — but only L0179 was ever confirmed
 * rendering by a person. L0169 demonstrably did NOT mount in production: it fell
 * through to the content card, which is the safe outcome but means every concept web
 * paid for a 0.3MB bundle and the empty-mount grace period before showing the card it
 * would have shown immediately.
 *
 * jsdom is not sufficient evidence for this. It cannot render L0173 at all (ECharts
 * needs a canvas it lacks), so a failure there proves nothing — and L0169's thin
 * render was read as the same kind of artifact when it was the real thing.
 *
 * Re-add one at a time, each only after it has been seen rendering a real item.
 */
export const NATIVE_LANGUAGES: NativeLanguage[] = [
  { id: "L0166", pkg: "@graffiticode/l0166" },
  // L0173 renders charts; L0179 supersedes L0166 and needed its own bundle, since
  // the DEPRECATED dialect rendered natively while its live replacement fell back
  // to a static preview — the wrong way round for the language 8 of 17 recent
  // items were authored in. Same `({ state })` Form contract as l0166.
  { id: "L0173", pkg: "@graffiticode/l0173" },
  { id: "L0179", pkg: "@graffiticode/l0179-view" },
];

/**
 * Languages that cannot render natively and must use the fallback content card.
 * Not a gap to be closed — each is non-renderable by design:
 *   L0158/L0176  inject Learnosity's vendor script at runtime
 *   L0177        emits a spec document, no runnable output
 *   L0170        a data provider; its output is a payload, not a view
 */
export const NON_RENDERABLE_LANGUAGES = new Set(["L0158", "L0176", "L0177", "L0170"]);

/** Normalize `0166` / `l0166` / `L0166` to `L0166`. */
export function normalizeLanguageId(lang: string): string {
  const digits = lang.replace(/^[lL]/, "");
  return `L${digits}`;
}

export function isNativeLanguage(lang: string): boolean {
  const id = normalizeLanguageId(lang);
  return NATIVE_LANGUAGES.some((l) => l.id === id);
}
