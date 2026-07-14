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

// Injected by the HTML generator: the origin serving /widget/lang/<id>.mjs.
declare const __MCP_ORIGIN__: string;
// Injected by the HTML generator: which languages have a native bundle.
declare const __NATIVE__: string[];

interface LangModule {
  styles: string;
  mount: (el: HTMLElement, data: unknown) => void;
}

function normalizeLang(lang: unknown): string {
  return `L${String(lang ?? "").replace(/^[lL]/, "")}`;
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
    const sc = r.structuredContent;
    const status = typeof sc.status === "string" ? sc.status : undefined;

    if (status === "generating") return showStatus(sc, "generating");
    if (status === "failed") return showStatus(sc, "failed");

    const lang = normalizeLang(sc.language);
    if (__NATIVE__.includes(lang) && sc.data) {
      try {
        await mountNative(lang, sc.data);
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
    mod.mount(root, data);
  }

  // --- Fallback content card (non-native languages) -------------------------

  function renderCard(sc: Record<string, unknown>): void {
    const lang = normalizeLang(sc.language);
    const card = el("div", "card");
    card.appendChild(el("div", "card-title", (sc.name as string) || "Your item is ready"));

    const body = cardBody(lang, sc);
    if (body) card.appendChild(body);

    // Primary action stays in-host: refine the item without leaving the chat.
    const actions = el("div", "card-actions");
    const refine = el("button", "btn", "Refine this item");
    refine.addEventListener("click", () =>
      host.sendMessage("Refine this item: ")
    );
    actions.appendChild(refine);
    card.appendChild(actions);

    root.className = "";
    root.replaceChildren(card);
    appendFooterLink(sc, card);
  }

  // Render real content from the data we already hold, so the card is a preview,
  // not an ad for our website. Shapes verified against the language compilers.
  function cardBody(lang: string, sc: Record<string, unknown>): HTMLElement | null {
    const data = sc.data as Record<string, unknown> | undefined;

    // Learnosity assessments: data = { type, request: { questions: [...] } }.
    if ((lang === "L0158" || lang === "L0176") && data) {
      const request = data.request as { questions?: unknown[] } | undefined;
      const questions = Array.isArray(request?.questions) ? request!.questions : [];
      if (questions.length) {
        const wrap = el("div", "card-body");
        wrap.appendChild(el("div", "card-text", `${questions.length} question${questions.length > 1 ? "s" : ""}`));
        const list = el("ol", "q-list");
        for (const q of questions.slice(0, 8)) {
          const qq = q as Record<string, unknown>;
          const li = el("li");
          const stimulus = String(qq.stimulus ?? qq.prompt ?? "").replace(/<[^>]+>/g, "").trim();
          li.appendChild(el("div", "q-stim", stimulus || "(question)"));
          const opts = qq.options as Array<Record<string, unknown>> | undefined;
          const valid = (qq["valid-response"] ?? qq.validResponse) as Record<string, unknown> | undefined;
          const correct = new Set(
            Array.isArray(valid?.value) ? (valid!.value as unknown[]).map(String) : []
          );
          if (Array.isArray(opts)) {
            const ul = el("ul", "q-opts");
            for (const o of opts) {
              const label = String(o.label ?? o.value ?? "");
              const isCorrect = correct.has(String(o.value));
              ul.appendChild(el("li", isCorrect ? "correct" : undefined, (isCorrect ? "✓ " : "") + label));
            }
            li.appendChild(ul);
          }
          list.appendChild(li);
        }
        wrap.appendChild(list);
        return wrap;
      }
    }

    // Spec doc: the item IS prose.
    if (lang === "L0177") {
      const text = String((data?.print ?? sc.spec ?? sc.src ?? "") || "");
      if (text) return el("pre", "card-pre", text.slice(0, 4000));
    }

    // Everything else: a compact, readable preview of the data we have.
    if (data) {
      return el("pre", "card-pre", JSON.stringify(data, null, 2).slice(0, 2000));
    }
    return el("div", "card-text", "Open it in Graffiticode to view.");
  }

  // --- Shared pieces --------------------------------------------------------

  function appendFooterLink(sc: Record<string, unknown>, container?: HTMLElement): void {
    const claimUrl = typeof sc.claim_url === "string" ? sc.claim_url : undefined;
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
