/**
 * MCP Apps widget entry (browser) for Graffiticode items.
 *
 * Runs inside the host's sandboxed iframe. Uses the official ext-apps `App`
 * class, which performs the JSON-RPC `ui/initialize` handshake over
 * postMessage, delivers the tool result via `ontoolresult`, surfaces host
 * context (theme), and auto-reports size changes to the host.
 *
 * Rendering: web-chat hosts (Claude, ChatGPT) block the embedded form iframe with
 * a hardcoded frame-src that ignores our declared frameDomains (Claude:
 * `frame-src 'self' blob: data:`, ChatGPT: `frame-src 'none'`), so we do NOT embed
 * a cross-origin iframe here. Instead we always render a status card driven by
 * `structuredContent.status` — "generating" (in progress, no link), "failed"
 * (error message), or an open/claim CTA once ready: "Sign in to save" (claim_url,
 * free-plan) or "Open in Graffiticode" (view_url, falling back to _meta.form_url),
 * opened in a real browser tab via the host open-link API. Never blank.
 * See OUTSTANDING.md — re-enable inline framing if/when hosts honor frameDomains.
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
  renderCard(sc, formUrl);
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
