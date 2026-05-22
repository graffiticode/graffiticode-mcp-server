/**
 * MCP Apps widget entry (browser) for Graffiticode items.
 *
 * Runs inside the host's sandboxed iframe. Uses the official ext-apps `App`
 * class, which performs the JSON-RPC `ui/initialize` handshake over
 * postMessage, delivers the tool result via `ontoolresult`, surfaces host
 * context (theme), and auto-reports size changes to the host.
 *
 * Rendering:
 *   - `_meta.form_url` present (authenticated): embed the rendered item in an
 *     iframe, with an "Open in Graffiticode" link below it.
 *   - otherwise (free-plan): the item lives in a session namespace and can't be
 *     rendered by an auth-less iframe, so show a claim CTA card built from
 *     `structuredContent.claim_url` / `claim_message` / `view_url`. Never blank.
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

function renderIframe(formUrl: string, viewUrl?: string): void {
  const iframe = document.createElement("iframe");
  iframe.src = formUrl;
  iframe.allow = "clipboard-read; clipboard-write";

  const frag = document.createDocumentFragment();
  frag.appendChild(iframe);
  if (viewUrl) frag.appendChild(linkButton("Open in Graffiticode ↗", viewUrl, "footer-link"));

  if (!contentEl) return;
  contentEl.className = "";
  contentEl.replaceChildren(frag);
}

function renderCard(sc: Record<string, unknown>): void {
  if (!contentEl) return;

  const claimUrl = typeof sc.claim_url === "string" ? sc.claim_url : undefined;
  const viewUrl = typeof sc.view_url === "string" ? sc.view_url : undefined;
  const link = claimUrl ?? viewUrl;

  const card = document.createElement("div");
  card.className = "card";

  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = "Your item is ready";
  card.appendChild(title);

  const text = document.createElement("div");
  text.className = "card-text";
  text.textContent = claimUrl
    ? "Sign in to view it and save it to your account."
    : "Open it in Graffiticode to view.";
  card.appendChild(text);

  if (link) {
    const actions = document.createElement("div");
    actions.className = "card-actions";
    actions.appendChild(
      linkButton(claimUrl ? "Sign in to view & save" : "Open in Graffiticode", link, "btn")
    );
    card.appendChild(actions);
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

  if (typeof meta.form_url === "string") {
    renderIframe(meta.form_url, typeof sc.view_url === "string" ? sc.view_url : undefined);
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
