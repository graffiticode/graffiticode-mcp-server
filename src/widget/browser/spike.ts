/**
 * SPIKE probe — temporary. Delete once the loading strategy is settled.
 *
 * Answers one question the docs do not: can a widget load a per-language module
 * at render time inside the host's sandbox, and does React render there?
 *
 * Deliberately has NO host-bridge dependency (no ext-apps `App`, no
 * `window.openai`). It renders from an embedded fixture, so a bridge failure
 * cannot confound the CSP/import results. Everything it learns is printed into
 * the widget itself, so the answer is visible in the host UI.
 *
 * Probes:
 *   P1  the host's applied CSP, read off a deliberately-tripped violation
 *   P2  dynamic `import(<origin>/widget/lang/L0166.mjs)` + mount   ← the open question
 *   P3  dynamically-inserted `<script type="module" src=…>`
 *   P4  dynamically-inserted classic `<script src=…iife.js>` + global  ← the proven fallback
 *
 * P2 doubles as the React control: if the import resolves but `mount()` throws,
 * the module loaded and React is the problem; if the import itself rejects, CSP is.
 */

// Injected by the HTML generator: the origin serving the language bundles.
declare const __MCP_ORIGIN__: string;
// Injected by the HTML generator: a real L0166 `data` object (shape produced by
// the l0166 compiler — title/instructions/validation/interaction.cells).
declare const __FIXTURE__: Record<string, unknown>;

const out = document.getElementById("out")!;
const stage = document.getElementById("stage")!;

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
  // Also to the console, so the desktop apps' devtools capture it.
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

let mounted = false;

// React 18's createRoot().render() is asynchronous — the DOM is not populated when
// mount() returns, so we must settle before asserting. Counting children synchronously
// would report a pass on an empty stage.
const settle = () => new Promise((r) => setTimeout(r, 600));

async function tryMount(mod: LangModule, label: string): Promise<void> {
  try {
    const style = document.createElement("style");
    style.textContent = mod.styles;
    document.head.appendChild(style);
    stage.replaceChildren();
    mod.mount(stage, __FIXTURE__);
    await settle();

    const nodes = stage.querySelectorAll("*").length;
    // The fixture's cell text must actually appear — proves Form consumed `data`,
    // not just that some DOM got created.
    const text = stage.textContent ?? "";
    const cellsRendered = ["Rent", "Groceries", "Savings"].filter((c) => text.includes(c));

    if (nodes === 0) {
      log("fail", `${label}: mount() produced no DOM`, "React did not render");
    } else if (cellsRendered.length === 0) {
      log("fail", `${label}: rendered ${nodes} nodes but no fixture data`, "Form ignored `data`");
    } else {
      mounted = true;
      log("ok", `${label}: FORM RENDERED`, `${nodes} nodes, cells: ${cellsRendered.join(", ")}`);
    }
  } catch (e) {
    // Module loaded, React failed. Distinguishes a CSP problem from a render problem.
    log("fail", `${label}: mount() threw`, err(e));
  }
}

// ------------------------------------------------------------------- the probes

const ESM_URL = `${__MCP_ORIGIN__}/widget/lang/L0166.mjs`;
const IIFE_URL = `${__MCP_ORIGIN__}/widget/lang/L0166.iife.js`;

async function p2DynamicImport(): Promise<boolean> {
  try {
    const mod = (await import(/* @vite-ignore */ ESM_URL)) as LangModule;
    if (typeof mod?.mount !== "function") {
      log("fail", "P2 dynamic import()", "resolved but no mount export");
      return false;
    }
    log("ok", "P2 dynamic import()", "module resolved");
    await tryMount(mod, "P2");
    return true;
  } catch (e) {
    log("fail", "P2 dynamic import()", err(e));
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

async function p3ModuleScriptTag(): Promise<void> {
  try {
    await loadScript(ESM_URL, "module");
    log("ok", "P3 <script type=module src>", "loaded");
  } catch (e) {
    log("fail", "P3 <script type=module src>", err(e));
  }
}

async function p4ClassicScriptTag(): Promise<void> {
  try {
    await loadScript(IIFE_URL);
    const g = (window as unknown as Record<string, LangModule | undefined>)["GC_L0166"];
    if (!g || typeof g.mount !== "function") {
      log("fail", "P4 classic <script src>", "loaded but global GC_L0166 missing");
      return;
    }
    log("ok", "P4 classic <script src>", "loaded, global present");
    // Only mount from the fallback if the primary path didn't already render.
    if (!mounted) await tryMount(g, "P4");
  } catch (e) {
    log("fail", "P4 classic <script src>", err(e));
  }
}

async function main(): Promise<void> {
  log("info", `origin: ${__MCP_ORIGIN__}`);
  log("info", `UA: ${navigator.userAgent.slice(0, 80)}`);
  tripCsp();
  const imported = await p2DynamicImport();
  await p3ModuleScriptTag();
  await p4ClassicScriptTag();
  log(
    "info",
    "VERDICT",
    imported ? "dynamic import() works → use it" : "dynamic import() blocked → use the script-tag fallback"
  );
}

void main();
