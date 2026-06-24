/**
 * MCP Apps widget entry (browser) for Graffiticode items.
 *
 * Runs inside the host's sandboxed iframe. Uses the official ext-apps `App`
 * class, which performs the JSON-RPC `ui/initialize` handshake over
 * postMessage, delivers the tool result via `ontoolresult`, surfaces host
 * context (theme), and auto-reports size changes to the host.
 *
 * Rendering:
 *   - `_meta.form_url` present: embed the rendered item in an iframe, with a
 *     footer link below it. Free-plan items render too — their compiled task is
 *     public by taskId — and get a "Sign in to save" link (claim_url); signed-in
 *     items get an "Open in Graffiticode" link (view_url).
 *   - otherwise: show a status card driven by `structuredContent.status` —
 *     "generating" (in progress, no link), "failed" (error message), or a claim/
 *     open CTA built from `claim_url` / `view_url` once ready. Never blank.
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

function renderIframe(formUrl: string, sc: Record<string, unknown>): void {
  const iframe = document.createElement("iframe");
  iframe.src = formUrl;
  iframe.allow = "clipboard-read; clipboard-write";

  // The embedded renderer posts its content height ({ type: "resize", height })
  // so we can size the iframe to the form instead of the fixed CSS fallback
  // (which left a large gap below short items). ext-apps then auto-resizes the
  // host card to match. Trust only messages from this iframe's own window.
  window.addEventListener("message", (e: MessageEvent) => {
    if (e.source !== iframe.contentWindow) return;
    const data = e.data as { type?: string; height?: number } | null;
    if (data && data.type === "resize" && typeof data.height === "number" && data.height > 0) {
      iframe.style.height = `${Math.ceil(data.height)}px`;
    }
  });

  const frag = document.createDocumentFragment();
  frag.appendChild(iframe);

  // Free-plan items carry a claim_url ("sign in to save"); their view_url points
  // at a session-scoped item the app can't load anonymously, so prefer the claim
  // link. Signed-in items have only view_url ("open in Graffiticode").
  const claimUrl = typeof sc.claim_url === "string" ? sc.claim_url : undefined;
  const viewUrl = typeof sc.view_url === "string" ? sc.view_url : undefined;
  if (claimUrl) {
    frag.appendChild(linkButton("Sign in to save ↗", claimUrl, "footer-link"));
  } else if (viewUrl) {
    frag.appendChild(linkButton("Open in Graffiticode ↗", viewUrl, "footer-link"));
  }

  if (!contentEl) return;
  contentEl.className = "";
  contentEl.replaceChildren(frag);
}

// Shown when there's no rendered item to embed (no _meta.form_url): while a
// generation is still running, when it failed, or as a claim/open CTA once an
// item is ready but can't be iframed. Status-driven so we never tell the user to
// "open" something that doesn't exist yet.
function renderCard(sc: Record<string, unknown>): void {
  if (!contentEl) return;

  const status = typeof sc.status === "string" ? sc.status : undefined;
  const claimUrl = typeof sc.claim_url === "string" ? sc.claim_url : undefined;
  const viewUrl = typeof sc.view_url === "string" ? sc.view_url : undefined;
  const link = claimUrl ?? viewUrl;

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
    text.textContent = "Your item is being created.";
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

  if (typeof meta.form_url === "string") {
    renderIframe(meta.form_url, sc);
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
