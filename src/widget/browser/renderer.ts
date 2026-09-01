/**
 * The shared widget renderer — one implementation for both hosts.
 *
 * A tool result arrives via the host adapter. If its language has a native bundle,
 * we dynamic-import it and mount the component (proven to work in the sandbox).
 * Otherwise we render a substantive content card from the data we already hold —
 * never a bare "click here" link, which OpenAI rejects as a "static frame with no
 * meaningful interaction".
 *
 * Not compiled by tsc (browser-only) — bundled by scripts/build-widget.mjs.
 */
import type { HostAdapter, ToolResult } from "./host.js";
import {
  contentToMarkdown,
  describeItem,
  isTerminalStatus,
  isRecord,
  mergeToolPayload,
  normalizeLang,
  type ItemContent,
} from "../../item-content.js";

// Re-exported because tests/widget-contract.test.ts imports it from here, and the
// widget's payload contract is the thing that test exists to pin.
export { mergeToolPayload };

// Injected by the HTML generator: the origin serving /widget/lang/<id>.mjs.
declare const __MCP_ORIGIN__: string;
// Injected by the HTML generator: which languages have a native bundle.
declare const __NATIVE__: string[];

interface LangModule {
  styles: string;
  mount: (el: HTMLElement, data: unknown) => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string
): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/**
 * How long to sit on "Loading…" before saying something truthful instead.
 *
 * Not a cancellation — the host keeps its subscription open and a result arriving
 * later still renders. This only bounds how long the panel is allowed to claim it
 * is loading when nothing has arrived.
 */
const FIRST_RESULT_DEADLINE_MS = 20_000;

/** How long a native component gets to draw something before the card takes over. */
const EMPTY_MOUNT_GRACE_MS = 1_500;

export function startRenderer(host: HostAdapter): void {
  const root = document.getElementById("content")!;
  // Latched only by a TERMINAL result. The previous `done` latch fired on the
  // FIRST result of any kind, and render_item returns { status: "generating" }
  // whenever its own 45s poll deadline expires — so a slow generation showed
  // "Generating…" and then permanently ignored the `ready` result that followed.
  // That contradicted ExtAppsHost's own contract, which promises delivery "again
  // whenever it changes", and made a slow item unrecoverable without a reload.
  let settled = false;
  let sawResult = false;

  host.onTheme((theme) => document.body.classList.toggle("dark", theme === "dark"));

  host.onToolResult((r) => {
    sawResult = true;
    if (settled) return;
    const sc = mergeToolPayload(r);
    const status = typeof sc.status === "string" ? sc.status : undefined;
    if (isTerminalStatus(status)) settled = true;
    void render(r);
  });

  // Nothing may end on "Loading…". Two host paths could previously do exactly
  // that, and neither surfaced an error: ExtAppsHost resolves connect() as soon
  // as the handshake succeeds, so a tool result that never arrives leaves the
  // panel untouched; SkybridgeHost polls for 60s and then returns SUCCESSFULLY,
  // making a timeout indistinguishable from a delivery. Bounding it here fixes
  // both at once, and is host-agnostic by construction.
  setTimeout(() => {
    if (sawResult || settled) return;
    renderWaiting();
  }, FIRST_RESULT_DEADLINE_MS);

  function reportHeight(): void {
    host.notifyHeight(document.body.scrollHeight + 24);
  }

  /**
   * The honest state when NOTHING has arrived. Deliberately not an error and
   * deliberately link-free: this fires only when no result has been delivered, so
   * there is no item id and no view_url to offer — a generating payload carries
   * neither by design. It says the true thing and gets replaced the moment a
   * result lands.
   */
  function renderWaiting(): void {
    const card = el("div", "card");
    card.appendChild(el("div", "card-title", "Still working…"));
    card.appendChild(
      el(
        "div",
        "card-text",
        "This is taking longer than usual. It will appear here when it is ready."
      )
    );
    root.className = "";
    root.replaceChildren(card);
    reportHeight();
  }

  async function render(r: ToolResult): Promise<void> {
    const sc = mergeToolPayload(r);
    const status = typeof sc.status === "string" ? sc.status : undefined;

    if (status === "generating") return showStatus(sc, "generating");
    if (status === "failed") return showStatus(sc, "failed");

    const lang = normalizeLang(sc.language);
    if (__NATIVE__.includes(lang) && sc.data !== undefined) {
      try {
        const mountPoint = await mountNative(lang, sc.data);
        appendFooterLink(sc);
        reportHeight();
        // A mount can "succeed" and draw nothing: React renders asynchronously,
        // so a component that throws inside its own tree, or simply produces no
        // output for a payload shape it doesn't recognise, resolves this promise
        // and then leaves an empty box. The try/catch below only sees synchronous
        // and import failures.
        //
        // That distinction decides whether a language can be made native safely.
        // Checked on a delay rather than inline so the ordinary path is not slowed
        // waiting to be told it worked; if the box is still empty by then, the
        // content card replaces it. This is what lets a language be added without
        // proving its renderer against every payload first — the worst case is the
        // card it would have shown anyway.
        setTimeout(() => {
          if (mountPoint.childNodes.length > 0) return;
          console.warn(`[widget] native mount for ${lang} drew nothing — using the card`);
          renderCard(sc);
          reportHeight();
        }, EMPTY_MOUNT_GRACE_MS);
        return;
      } catch (err) {
        // A native mount failure must not leave a blank frame — fall through to
        // the content card, which needs no bundle.
        console.error("[widget] native mount failed:", err);
      }
    }
    renderCard(sc);
    reportHeight();
  }

  async function mountNative(lang: string, data: unknown): Promise<HTMLElement> {
    const mod = (await import(`${__MCP_ORIGIN__}/widget/lang/${lang}.mjs`)) as LangModule;
    const style = el("style");
    style.textContent = mod.styles;
    document.head.appendChild(style);
    root.className = "";
    root.replaceChildren();
    const mountPoint = el("div", "native-content");
    root.appendChild(mountPoint);
    mod.mount(mountPoint, data);
    return mountPoint;
  }

  // --- Fallback content card (non-native languages) -------------------------

  function renderCard(sc: Record<string, unknown>): void {
    const lang = normalizeLang(sc.language);
    const card = el("div", "card");
    card.appendChild(el("div", "card-title", (sc.name as string) || "Your item is ready"));

    const body = cardBody(lang, sc);
    if (body) card.appendChild(body);

    root.className = "";
    root.replaceChildren(card);
    appendFooterLink(sc, card);
  }

  // Render the shared content model as DOM. The extraction lives in
  // item-content.ts so the tool result's text says the same thing this card does;
  // what stays here is only the markup.
  function cardBody(lang: string, sc: Record<string, unknown>): HTMLElement | null {
    const content: ItemContent = describeItem(lang, sc);

    if (content.kind === "questions") {
      const wrap = el("div", "card-body");
      const n = content.count;
      wrap.appendChild(el("div", "card-text", `${n} question${n === 1 ? "" : "s"}`));
      const list = el("ol", "q-list");
      for (const q of content.shown) {
        const li = el("li");
        li.appendChild(el("div", "q-stim", q.stimulus));
        if (q.options.length) {
          const ul = el("ul", "q-opts");
          for (const o of q.options) {
            ul.appendChild(
              el("li", o.correct ? "correct" : undefined, (o.correct ? "✓ " : "") + o.label)
            );
          }
          li.appendChild(ul);
        }
        list.appendChild(li);
      }
      wrap.appendChild(list);
      return wrap;
    }

    if (content.kind === "table") {
      const wrap = el("div", "card-body");
      // Named only when there is more than one — see contentToMarkdown.
      if (content.sheetName && content.totalSheets > 1) {
        wrap.appendChild(el("div", "card-text", content.sheetName));
      }
      const table = el("table", "card-table");
      const thead = el("thead");
      const hr = el("tr");
      for (const h of content.headers) hr.appendChild(el("th", undefined, h));
      thead.appendChild(hr);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const row of content.rows) {
        const tr = el("tr");
        for (let i = 0; i < content.headers.length; i++) {
          tr.appendChild(el("td", undefined, row[i] ?? ""));
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      const hidden = content.totalRows - content.rows.length;
      if (hidden > 0 || content.totalSheets > 1) {
        wrap.appendChild(el("div", "card-text", "Open it in Graffiticode to see the rest."));
      }
      return wrap;
    }

    // Chart and concept web reuse the plain-text shapes the summary emits; the
    // native bundle renders the real thing when there is one, and this is the
    // readable fallback when there isn't.
    if (content.kind === "chart" || content.kind === "conceptweb") {
      const wrap = el("div", "card-body");
      for (const line of contentToMarkdown(content).split("\n")) {
        if (line.trim()) wrap.appendChild(el("div", "card-text", line.replace(/\*\*/g, "")));
      }
      return wrap;
    }

    if (content.kind === "prose") return el("pre", "card-pre", content.text);
    // The raw dump stays here — a last resort inside a scrollable panel, and the
    // reason contentToMarkdown refuses to put this shape in a chat message.
    if (content.kind === "preview") return el("pre", "card-pre", content.json);
    return el("div", "card-text", "Open it in Graffiticode to view.");
  }

  // --- Shared pieces --------------------------------------------------------

  function appendFooterLink(sc: Record<string, unknown>, container?: HTMLElement): void {
    // Prefer the widget-stamped claim URL (src=widget) so a click here is
    // distinguishable in the funnel both from the link an agent prints (src=chat)
    // and from the app's /form footer (src=footer) — three surfaces, three values.
    // `claim_url` is the fallback for a hydration payload minted before the server
    // carried both; it costs the attribution, not the claim.
    const claimUrl =
      typeof sc.claim_url_widget === "string" ? sc.claim_url_widget :
      typeof sc.claim_url === "string" ? sc.claim_url : undefined;
    const viewUrl = typeof sc.view_url === "string" ? sc.view_url : undefined;
    const label = claimUrl ? "Sign in to save ↗" : viewUrl ? "Open in Graffiticode ↗" : null;
    const url = claimUrl ?? viewUrl;
    if (!label || !url) return;
    const link = el("button", "footer-link", label);
    link.addEventListener("click", () => host.openLink(url));
    (container ?? root).appendChild(link);
  }

  function showStatus(sc: Record<string, unknown>, status: "generating" | "failed"): void {
    const card = el("div", "card");
    if (status === "generating") {
      card.appendChild(el("div", "card-title", "Generating…"));
      card.appendChild(
        el("div", "card-text", sc.operation === "update" ? "Your item is being updated." : "Your item is being created.")
      );
    } else {
      card.appendChild(el("div", "card-title", "Generation failed"));
      card.appendChild(el("div", "card-text", typeof sc.error === "string" ? sc.error : "Something went wrong."));
    }
    root.className = "";
    root.replaceChildren(card);
    reportHeight();
  }
}
