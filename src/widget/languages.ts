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
  /** Published version, pinned into the esm.sh URL for reproducibility. */
  version: string;
}

/** React version the widget pins everywhere (via esm.sh `?deps`) so the language
 * `Form` and react-dom share ONE React instance — otherwise hooks throw. */
export const REACT_VERSION = "18.3.1";

/** The esm.sh URL the widget dynamic-imports a language's `Form` from.
 * esm.sh is used because ChatGPT's widget sandbox only allows scripts from a fixed
 * CDN allowlist (esm.sh/unpkg/jsdelivr), NOT from our own origin — while Claude
 * honors esm.sh in resourceDomains. `?deps` pins React so there's a single copy. */
export function esmUrl(l: NativeLanguage): string {
  return `https://esm.sh/${l.pkg}@${l.version}?deps=react@${REACT_VERSION},react-dom@${REACT_VERSION}`;
}

/**
 * Languages whose npm package exports a `Form` that renders purely from the
 * item's `data` — no network, no vendor script. These get a native bundle.
 *
 * Adding one is a one-line entry, but check its `Form` signature first: the
 * props contract is NOT uniform across packages (l0166 is `({state})`, l0158 is
 * `({state, targetOrigin})`).
 */
export const NATIVE_LANGUAGES: NativeLanguage[] = [
  { id: "L0166", pkg: "@graffiticode/l0166", version: "0.1.6" },
  { id: "L0173", pkg: "@graffiticode/l0173", version: "0.1.0" },
  { id: "L0169", pkg: "@graffiticode/l0169", version: "0.1.0" },
  // NOT L0172: its Form renders a Figma <iframe> (BoardView → figma.com/embed),
  // which would need frameDomains:figma.com in the CSP — exactly the iframe/embed
  // pattern we removed to pass OpenAI review. It belongs in the fallback set.
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
