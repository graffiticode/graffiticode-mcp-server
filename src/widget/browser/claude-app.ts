/**
 * MCP Apps widget entry (browser) for Graffiticode items.
 *
 * Runs inside the host's sandboxed iframe. Uses the official ext-apps `App`
 * class, which performs the JSON-RPC `ui/initialize` handshake over
 * postMessage, delivers the tool result via `ontoolresult`, surfaces host
 * context (theme), and auto-reports size changes to the host.
 *
 * Rendering is ADAPTIVE per host:
 *   - `_meta.form_url` present: embed the rendered item in an iframe. Desktop apps
 *     honor our declared frameDomains and show it inline. Web hosts (Claude/ChatGPT)
 *     apply a hardcoded frame-src that ignores frameDomains and block the frame
 *     (Claude `'self' blob: data:`, ChatGPT `'none'`) — we detect that via the
 *     `securitypolicyviolation` event (plus a load/timeout safety net) and fall
 *     back to the open-in-browser CTA. See OUTSTANDING.md.
 *   - otherwise: a status card driven by `structuredContent.status` — "generating",
 *     "failed", or an open/claim CTA ("Sign in to save" claim_url, else
 *     "Open in Graffiticode" view_url→form_url). Never blank.
 *
 * This file is NOT compiled by `tsc` (excluded in tsconfig). It is bundled to a
 * single IIFE by `scripts/build-widget.mjs` and inlined into the resource HTML
 * by `generateClaudeWidgetHtml()`.
 */
import { App } from "@modelcontextprotocol/ext-apps";

const contentEl = document.getElementById("content");
let rendered = false;

const app = new App({ name: "graffiticode-form", version: "1.0.0" });

function applyTheme(theme?: string): void {
  document.body.classList.toggle("dark", theme === "dark");
}

// Open an external URL via the host (sandboxed iframes can't navigate top-level
// directly). Fall back to window.open if the host rejects the request.
function openExternal(url: string): void {
  app.openLink({ url }).catch(() => {
    try {
      window.open(url, "_blank", "noopener");
    } catch {
      /* ignore */
    }
  });
}

function linkButton(label: string, url: string, className: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener("click", () => openExternal(url));
  return btn;
}

// Embed the rendered item. Hosts that allow the cross-origin frame (desktop apps)
// show it inline; hosts that block it with a hardcoded sandbox frame-src (Claude/
// ChatGPT web) fire a `securitypolicyviolation` — we catch that and fall back to
// the open-in-browser CTA. `load` marks a successful (unblocked) embed so the
// timeout safety net never replaces a working inline frame (e.g. a renderer that
// doesn't post its height). See OUTSTANDING.md.
function renderIframe(formUrl: string, sc: Record<string, unknown>): void {
  if (!contentEl) return;

  const iframe = document.createElement("iframe");
  iframe.src = formUrl;
  iframe.allow = "clipboard-read; clipboard-write";

  let loaded = false;
  let done = false;
  const cleanup = () => {
    window.removeEventListener("message", onMessage);
    document.removeEventListener("securitypolicyviolation", onViolation);
    clearTimeout(timer);
  };
  const fallbackToCta = () => {
    if (done) return;
    done = true;
    cleanup();
    renderCard(sc, formUrl);
  };

  // The embedded renderer posts its content height so we size the iframe to the
  // form. Receiving it also proves the frame loaded (not blocked). Trust only
  // messages from this iframe's own window.
  const onMessage = (e: MessageEvent) => {
    if (e.source !== iframe.contentWindow) return;
    const data = e.data as { type?: string; height?: number } | null;
    if (data && data.type === "resize" && typeof data.height === "number" && data.height > 0) {
      loaded = true;
      iframe.style.height = `${Math.ceil(data.height)}px`;
    }
  };
  // Host CSP blocked our form frame (web): switch to the CTA immediately.
  const onViolation = (e: SecurityPolicyViolationEvent) => {
    const dir = e.effectiveDirective || e.violatedDirective || "";
    if (dir.indexOf("frame-src") !== -1) fallbackToCta();
  };
  // A successful cross-origin load fires `load` (even though we can't read it);
  // a frame-src block does not. So `load` ⇒ not blocked ⇒ keep the inline frame.
  iframe.addEventListener("load", () => {
    loaded = true;
  });
  window.addEventListener("message", onMessage);
  document.addEventListener("securitypolicyviolation", onViolation);
  // Safety net for a silent block (no violation event, no load): fall back only
  // if nothing indicated the frame is alive.
  const timer = setTimeout(() => {
    if (!loaded) fallbackToCta();
  }, 7000);

  const frag = document.createDocumentFragment();
  frag.appendChild(iframe);

  // Free-plan items carry a claim_url ("sign in to save"); signed-in items have a
  // view_url ("open in Graffiticode"). Shown as a footer link below the frame.
  const claimUrl = typeof sc.claim_url === "string" ? sc.claim_url : undefined;
  const viewUrl = typeof sc.view_url === "string" ? sc.view_url : undefined;
  if (claimUrl) {
    frag.appendChild(linkButton("Sign in to save ↗", claimUrl, "footer-link"));
  } else if (viewUrl) {
    frag.appendChild(linkButton("Open in Graffiticode ↗", viewUrl, "footer-link"));
  }

  contentEl.className = "";
  contentEl.replaceChildren(frag);
}

// Status card: while a generation is still running, when it failed, or as a
// claim/open CTA once an item is ready. The item can't be embedded (host CSP
// blocks the cross-origin iframe), so "ready" always offers an open-in-browser
// CTA. Status-driven so we never tell the user to "open" something not ready yet.
function renderCard(sc: Record<string, unknown>, formUrl?: string): void {
  if (!contentEl) return;

  const status = typeof sc.status === "string" ? sc.status : undefined;
  const claimUrl = typeof sc.claim_url === "string" ? sc.claim_url : undefined;
  const viewUrl = typeof sc.view_url === "string" ? sc.view_url : undefined;
  // Prefer the app view_url (or claim_url for free-plan); fall back to the embed
  // form_url so there's always a way to open the item in a browser tab.
  const link = claimUrl ?? viewUrl ?? formUrl;

  const card = document.createElement("div");
  card.className = "card";

  const title = document.createElement("div");
  title.className = "card-title";
  card.appendChild(title);

  const text = document.createElement("div");
  text.className = "card-text";
  card.appendChild(text);

  if (status === "generating") {
    title.textContent = "Generating…";
    text.textContent =
      sc.operation === "update" ? "Your item is being updated." : "Your item is being created.";
  } else if (status === "failed") {
    title.textContent = "Generation failed";
    text.textContent =
      typeof sc.error === "string" ? sc.error : "Something went wrong generating this item.";
  } else {
    title.textContent = "Your item is ready";
    // Only invite the user to open it when we actually have a link to offer.
    text.textContent = !link
      ? ""
      : claimUrl
        ? "Sign in to view it and save it to your account."
        : "Open it in Graffiticode to view.";
    if (link) {
      const actions = document.createElement("div");
      actions.className = "card-actions";
      actions.appendChild(
        linkButton(claimUrl ? "Sign in to view & save" : "Open in Graffiticode", link, "btn")
      );
      card.appendChild(actions);
    }
  }

  contentEl.className = "";
  contentEl.replaceChildren(card);
}

function render(params: {
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}): void {
  if (rendered || !contentEl) return;
  rendered = true;

  const sc = params.structuredContent ?? {};
  const meta = params._meta ?? {};
  const formUrl = typeof meta.form_url === "string" ? meta.form_url : undefined;
  if (formUrl) {
    renderIframe(formUrl, sc);
  } else {
    renderCard(sc);
  }
}

// Register handlers before connecting so no early notifications are missed.
app.ontoolresult = (params) => render(params);
app.onhostcontextchanged = (ctx) => applyTheme(ctx.theme);

app
  .connect()
  .then(() => applyTheme(app.getHostContext()?.theme))
  .catch((err: unknown) => {
    if (!contentEl) return;
    contentEl.className = "error";
    contentEl.textContent = "Failed to connect to host: " + (err instanceof Error ? err.message : String(err));
  });
