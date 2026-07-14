/**
 * SPIKE probe — temporary. Delete once the loading strategy is settled.
 *
 * Answers one question the docs do not: can a widget load a per-language module
 * at render time inside the host's sandbox, and does React render there?
 *
 * Deliberately has NO host-bridge dependency (no ext-apps `App`, no
 * `window.openai`). It renders from embedded fixtures, so a bridge failure cannot
 * confound the CSP/import results. Everything it learns is printed into the widget
 * itself, so the answer is visible in the host UI.
 *
 * Probes:
 *   P1  the host's applied CSP, read off a deliberately-tripped violation
 *   P2  dynamic `import(<origin>/widget/lang/<id>.mjs)` + mount, per language ← the open question
 *   P3  dynamically-inserted `<script type="module" src=…>`
 *   P4  dynamically-inserted classic `<script src=…iife.js>` + global  ← the proven fallback
 *
 * P2 doubles as the React control: if the import resolves but `mount()` throws,
 * the module loaded and React is the problem; if the import itself rejects, CSP is.
 */

import { App } from "@modelcontextprotocol/ext-apps";

// Injected by the HTML generator.
declare const __MCP_ORIGIN__: string;
declare const __CASES__: Array<{
  id: string;
  data: Record<string, unknown>;
  /** Text that must appear once rendered (DOM-rendered languages). */
  needles?: string[];
  /** Whether the language draws to a canvas/svg instead of text (e.g. ECharts). */
  graphic?: boolean;
}>;

const out = document.getElementById("out")!;
const stages = document.getElementById("stages")!;

type Status = "ok" | "fail" | "info";

function log(status: Status, label: string, detail = ""): void {
  const row = document.createElement("div");
  row.className = `row ${status}`;
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = status === "ok" ? "PASS" : status === "fail" ? "FAIL" : "····";
  const text = document.createElement("span");
  text.textContent = ` ${label}${detail ? " — " + detail : ""}`;
  row.append(tag, text);
  out.appendChild(row);
  console.log(`[spike] ${status.toUpperCase()} ${label} ${detail}`);
}

const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------- P1: the CSP

// The violation event carries `originalPolicy` — the host's ENTIRE applied CSP.
// One violation tells us everything: whether resourceDomains reached script-src,
// what frame-src is really set to, whether blob:/data: survived.
let policyPrinted = false;
document.addEventListener("securitypolicyviolation", (e) => {
  const ev = e as SecurityPolicyViolationEvent;
  log("info", `CSP violation: ${ev.effectiveDirective}`, `blocked ${ev.blockedURI}`);
  if (!policyPrinted && ev.originalPolicy) {
    policyPrinted = true;
    const pre = document.createElement("pre");
    pre.textContent = ev.originalPolicy.replace(/;\s*/g, ";\n");
    out.appendChild(pre);
    console.log("[spike] applied CSP:\n" + ev.originalPolicy);
  }
});

// Deliberately trip it, so we get the policy even when every real probe passes.
function tripCsp(): void {
  const s = document.createElement("script");
  s.src = "https://csp-probe.invalid/trip.js";
  document.head.appendChild(s);
  fetch("https://csp-probe.invalid/trip").catch(() => {
    /* expected */
  });
}

// ------------------------------------------------------------ the render check

interface LangModule {
  styles: string;
  mount: (el: HTMLElement, data: unknown) => void;
}

// React 18's createRoot().render() is asynchronous — the DOM is not populated when
// mount() returns. Counting synchronously would report a pass on an empty stage.
// ECharts also needs a tick (and a laid-out container) before it paints.
const settle = () => new Promise((r) => setTimeout(r, 800));

const mounted = new Set<string>();

async function tryMount(mod: LangModule, c: (typeof __CASES__)[number], label: string): Promise<void> {
  try {
    const style = document.createElement("style");
    style.textContent = mod.styles;
    document.head.appendChild(style);

    const stage = document.createElement("div");
    stage.className = "stage";
    stage.style.width = "460px";
    stage.style.minHeight = c.graphic ? "260px" : "0";
    stages.appendChild(stage);

    mod.mount(stage, c.data);
    await settle();

    const nodes = stage.querySelectorAll("*").length;
    if (nodes === 0) {
      log("fail", `${label} ${c.id}: no DOM`, "React did not render");
      return;
    }

    // A chart paints to <canvas>/<svg> and has no text; a spreadsheet has text and
    // no canvas. Assert on whichever this language actually produces, so a pass
    // means "the component really rendered the fixture", not just "some DOM exists".
    if (c.graphic) {
      const g = stage.querySelector("canvas, svg");
      if (!g) {
        log("fail", `${label} ${c.id}: ${nodes} nodes but no canvas/svg`, "chart did not paint");
        return;
      }
      const w = (g as HTMLCanvasElement).width || g.clientWidth;
      mounted.add(c.id);
      log("ok", `${label} ${c.id}: CHART RENDERED`, `${nodes} nodes, <${g.tagName.toLowerCase()}> ${w}px`);
      return;
    }

    const text = stage.textContent ?? "";
    const found = (c.needles ?? []).filter((n) => text.includes(n));
    if ((c.needles ?? []).length && found.length === 0) {
      log("fail", `${label} ${c.id}: ${nodes} nodes but no fixture data`, "Form ignored `data`");
      return;
    }
    mounted.add(c.id);
    log("ok", `${label} ${c.id}: FORM RENDERED`, `${nodes} nodes, found: ${found.join(", ")}`);
  } catch (e) {
    // Module loaded, React failed. Distinguishes a CSP problem from a render problem.
    log("fail", `${label} ${c.id}: mount() threw`, err(e));
  }
}

// ------------------------------------------------------------------- the probes

const esmUrl = (id: string) => `${__MCP_ORIGIN__}/widget/lang/${id}.mjs`;
const iifeUrl = (id: string) => `${__MCP_ORIGIN__}/widget/lang/${id}.iife.js`;

async function p2DynamicImport(c: (typeof __CASES__)[number]): Promise<boolean> {
  try {
    const mod = (await import(/* @vite-ignore */ esmUrl(c.id))) as LangModule;
    if (typeof mod?.mount !== "function") {
      log("fail", `P2 import ${c.id}`, "resolved but no mount export");
      return false;
    }
    log("ok", `P2 import ${c.id}`, "module resolved");
    await tryMount(mod, c, "P2");
    return true;
  } catch (e) {
    log("fail", `P2 import ${c.id}`, err(e));
    return false;
  }
}

function loadScript(src: string, type?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    if (type) s.type = type;
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("script load error (blocked or 404)"));
    document.head.appendChild(s);
  });
}

/**
 * Complete the host handshake.
 *
 * The first cut of this probe had NO bridge at all — a deliberate choice, so a
 * bridge failure could not confound the CSP results. That backfired: MCP Apps
 * hosts perform a `ui/initialize` handshake and size the view from it, so with no
 * `App.connect()` the host had no height for us and rendered an empty frame — even
 * though the probe ran fine and fetched both bundles. The handshake is what makes
 * the view visible, so it has to happen before anything is worth reporting.
 *
 * Both bridges are best-effort: a failure is logged, not fatal, and the probes run
 * either way (they need no host).
 */
async function connectHost(): Promise<void> {
  const openai = (window as unknown as { openai?: { notifyIntrinsicHeight?: (h: number) => void } }).openai;

  try {
    const app = new App({ name: "graffiticode-spike", version: "1.0.0" });
    // Bounded: a host that never answers the handshake must not hang the probes,
    // or we'd render an empty frame again — same symptom, different cause.
    await Promise.race([
      app.connect(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("handshake timed out after 3s")), 3000)),
    ]);
    log("ok", "host bridge", "ext-apps ui/initialize handshake ok (MCP Apps)");
  } catch (e) {
    if (openai) log("info", "host bridge", "no ext-apps; using window.openai (Skybridge)");
    else log("fail", "host bridge", err(e));
  }

  // Skybridge sizes from an explicit call rather than the ext-apps auto-resize.
  if (openai?.notifyIntrinsicHeight) {
    const report = () => openai.notifyIntrinsicHeight!(document.body.scrollHeight);
    new ResizeObserver(report).observe(document.body);
    report();
  }
}

async function main(): Promise<void> {
  await connectHost();
  log("info", `origin: ${__MCP_ORIGIN__}`);
  log("info", `UA: ${navigator.userAgent.slice(0, 70)}`);
  tripCsp();

  // P2 — the open question, run for every registered language.
  let anyImported = false;
  for (const c of __CASES__) {
    if (await p2DynamicImport(c)) anyImported = true;
  }

  // P3/P4 — transport fallbacks. Exercised on the first language only; they test
  // how code gets in, not which component it is.
  const first = __CASES__[0];
  try {
    await loadScript(esmUrl(first.id), "module");
    log("ok", "P3 <script type=module src>", "loaded");
  } catch (e) {
    log("fail", "P3 <script type=module src>", err(e));
  }

  try {
    await loadScript(iifeUrl(first.id));
    const g = (window as unknown as Record<string, LangModule | undefined>)[`GC_${first.id}`];
    if (!g || typeof g.mount !== "function") {
      log("fail", "P4 classic <script src>", `loaded but global GC_${first.id} missing`);
    } else {
      log("ok", "P4 classic <script src>", "loaded, global present");
      // Only mount from the fallback if the primary path didn't already render.
      if (!mounted.has(first.id)) await tryMount(g, first, "P4");
    }
  } catch (e) {
    log("fail", "P4 classic <script src>", err(e));
  }

  log(
    "info",
    "VERDICT",
    anyImported
      ? `dynamic import() works → use it (rendered: ${[...mounted].join(", ") || "none"})`
      : "dynamic import() blocked → use the script-tag fallback"
  );
}

void main();
