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
  describeItem,
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

export function startRenderer(host: HostAdapter): void {
  const root = document.getElementById("content")!;
  let done = false;

  host.onTheme((theme) => document.body.classList.toggle("dark", theme === "dark"));

  host.onToolResult((r) => {
    if (done) return; // first result wins; ignore duplicate deliveries
    done = true;
    void render(r);
  });

  function reportHeight(): void {
    host.notifyHeight(document.body.scrollHeight + 24);
  }

  async function render(r: ToolResult): Promise<void> {
    const sc = mergeToolPayload(r);
    const status = typeof sc.status === "string" ? sc.status : undefined;

    if (status === "generating") return showStatus(sc, "generating");
    if (status === "failed") return showStatus(sc, "failed");

    const lang = normalizeLang(sc.language);
    if (__NATIVE__.includes(lang) && sc.data !== undefined) {
      try {
        await mountNative(lang, sc.data);
        appendRefineAction(sc);
        appendFooterLink(sc);
        reportHeight();
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

  async function mountNative(lang: string, data: unknown): Promise<void> {
    const mod = (await import(`${__MCP_ORIGIN__}/widget/lang/${lang}.mjs`)) as LangModule;
    const style = el("style");
    style.textContent = mod.styles;
    document.head.appendChild(style);
    root.className = "";
    root.replaceChildren();
    const mountPoint = el("div", "native-content");
    root.appendChild(mountPoint);
    mod.mount(mountPoint, data);
  }

  // --- Fallback content card (non-native languages) -------------------------

  function renderCard(sc: Record<string, unknown>): void {
    const lang = normalizeLang(sc.language);
    const card = el("div", "card");
    card.appendChild(el("div", "card-title", (sc.name as string) || "Your item is ready"));

    const body = cardBody(lang, sc);
    if (body) card.appendChild(body);

    appendRefineAction(sc, card);

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

    if (content.kind === "prose") return el("pre", "card-pre", content.text);
    // The raw dump stays here — a last resort inside a scrollable panel, and the
    // reason contentToMarkdown refuses to put this shape in a chat message.
    if (content.kind === "preview") return el("pre", "card-pre", content.json);
    return el("div", "card-text", "Open it in Graffiticode to view.");
  }

  // --- Shared pieces --------------------------------------------------------

  function appendRefineAction(sc: Record<string, unknown>, container?: HTMLElement): void {
    const itemId = typeof sc.item_id === "string" ? sc.item_id : undefined;
    if (!itemId) return;

    const form = el("form", "refine-form");
    const input = el("input", "refine-input");
    input.type = "text";
    input.placeholder = "Describe what to change";
    input.setAttribute("aria-label", "Describe how to refine this item");
    const submit = el("button", "btn", "Refine");
    submit.type = "submit";
    form.append(input, submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const modification = input.value.trim();
      if (!modification) {
        input.focus();
        return;
      }
      host.sendMessage(
        `Please update Graffiticode item ${itemId}: ${modification}`,
      );
      input.value = "";
    });
    (container ?? root).appendChild(form);
  }

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
