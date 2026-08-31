/**
 * Host adapter — the one seam between the shared renderer and the two hosts.
 *
 * Claude (and other MCP Apps hosts) speak the ext-apps `App` bridge; ChatGPT
 * speaks `window.openai` (Skybridge). The renderer is written once against this
 * interface; each host gets a thin adapter. This is what lets a single native
 * renderer serve both, instead of the two drifting widgets we had before.
 *
 * Not compiled by tsc (browser-only) — bundled by scripts/build-widget.mjs.
 */
import { App } from "@modelcontextprotocol/ext-apps";

export interface ToolResult {
  structuredContent: Record<string, unknown>;
  meta: Record<string, unknown>;
}

export interface HostAdapter {
  /** Complete the host handshake and return the initial tool result if one is ready. */
  connect(): Promise<void>;
  /** The tool result, delivered now if present and again whenever it changes. */
  onToolResult(cb: (r: ToolResult) => void): void;
  /** "light" | "dark" | undefined, delivered now and on change. */
  onTheme(cb: (theme: string | undefined) => void): void;
  /** Open a URL in a new tab via the host (sandboxed frames can't navigate top-level). */
  openLink(url: string): void;
  /** Start a follow-up user turn (drives "Refine this item" → update_item). */
  sendMessage(text: string): void;
  /** Report the content height so the host can size the view. */
  notifyHeight(px: number): void;
}

const windowOpenai = () =>
  (window as unknown as { openai?: Record<string, unknown> }).openai;

/** MCP Apps host (Claude et al.), wrapping the ext-apps App class. */
class ExtAppsHost implements HostAdapter {
  private app = new App({ name: "graffiticode-form", version: "1.0.0" });
  private toolCb?: (r: ToolResult) => void;
  private themeCb?: (t: string | undefined) => void;

  onToolResult(cb: (r: ToolResult) => void): void {
    this.toolCb = cb;
    // Register before connect so an early notification isn't missed.
    this.app.ontoolresult = (params) =>
      cb({
        structuredContent: (params.structuredContent ?? {}) as Record<string, unknown>,
        meta: (params._meta ?? {}) as Record<string, unknown>,
      });
  }

  onTheme(cb: (t: string | undefined) => void): void {
    this.themeCb = cb;
    this.app.onhostcontextchanged = (ctx) => cb(ctx.theme);
  }

  async connect(): Promise<void> {
    await this.app.connect();
    this.themeCb?.(this.app.getHostContext()?.theme);
  }

  openLink(url: string): void {
    this.app.openLink({ url }).catch(() => window.open(url, "_blank", "noopener"));
  }

  sendMessage(text: string): void {
    this.app.sendMessage({ role: "user", content: [{ type: "text", text }] }).catch(() => {
      /* best-effort */
    });
  }

  notifyHeight(): void {
    // The ext-apps App auto-reports size via a ResizeObserver; nothing to do.
  }
}

/** ChatGPT Apps host, wrapping window.openai (Skybridge). */
class SkybridgeHost implements HostAdapter {
  private toolCb?: (r: ToolResult) => void;
  private ro?: ResizeObserver;

  private read(): ToolResult | null {
    const o = windowOpenai();
    if (!o) return null;
    const toolOutput = (o.toolOutput ?? o.props) as Record<string, unknown> | undefined;
    if (!toolOutput || Object.keys(toolOutput).length === 0) return null;
    const structuredContent = (toolOutput.structuredContent ?? toolOutput) as Record<string, unknown>;
    const meta = (o.toolResponseMetadata ?? toolOutput._meta ?? {}) as Record<string, unknown>;
    return { structuredContent, meta };
  }

  onToolResult(cb: (r: ToolResult) => void): void {
    this.toolCb = cb;
    // Skybridge exposes the result on a global rather than an event; the watch
    // loop started by connect() delivers it, and delivers again if it changes.
  }

  onTheme(cb: (t: string | undefined) => void): void {
    const o = windowOpenai();
    cb(o?.theme as string | undefined);
    // Skybridge re-renders the iframe on theme change, so a one-shot read suffices.
  }

  async connect(): Promise<void> {
    // Deliver the first result, then keep watching.
    //
    // This used to be a bare 120 x 500ms loop that, on exhaustion, simply fell out
    // and RESOLVED — no throw, so entry.ts's catch never fired and a timeout was
    // indistinguishable from a delivery. The panel stayed on "Loading…" forever.
    // That is the "stuck Generating…" report that put ChatGPT behind a whitelist.
    //
    // Two things changed. The wait is no longer the thing standing between the
    // user and a rendered panel — the renderer bounds that itself and shows a
    // truthful state — so this can watch for as long as a generation plausibly
    // runs (minutes, not one minute) without anyone staring at a spinner. And it
    // keeps watching AFTER the first delivery, because render_item answers
    // { status: "generating" } when its own poll deadline expires; without a
    // second delivery the widget would hold that first non-terminal answer
    // forever. That matches ExtAppsHost, whose contract already promises delivery
    // "again whenever it changes".
    let last = "";
    const deliver = (): boolean => {
      const r = this.read();
      if (!r) return false;
      // Cheap identity check: only re-deliver when the payload actually differs,
      // so a stable result doesn't re-render the panel every tick.
      const key = JSON.stringify(r.structuredContent);
      if (key === last) return true;
      last = key;
      this.toolCb?.(r);
      return true;
    };

    for (let i = 0; i < 40; i++) {
      if (deliver()) break;
      await new Promise((res) => setTimeout(res, 500));
    }

    // Background watch. Bounded so a forgotten panel doesn't poll indefinitely;
    // generously, because generation legitimately runs into the minutes.
    let ticks = 0;
    const timer = setInterval(() => {
      deliver();
      if (++ticks > 120) clearInterval(timer); // ~4 minutes at 2s
    }, 2000);
  }

  openLink(url: string): void {
    const o = windowOpenai() as { openExternal?: (a: { href: string }) => void } | undefined;
    if (o?.openExternal) o.openExternal({ href: url });
    else window.open(url, "_blank", "noopener");
  }

  sendMessage(text: string): void {
    const o = windowOpenai() as
      | { sendFollowUpMessage?: (a: { prompt: string }) => void }
      | undefined;
    o?.sendFollowUpMessage?.({ prompt: text });
  }

  notifyHeight(px: number): void {
    const o = windowOpenai() as { notifyIntrinsicHeight?: (h: number) => void } | undefined;
    if (!o?.notifyIntrinsicHeight) return;
    o.notifyIntrinsicHeight(px);
    if (!this.ro) {
      this.ro = new ResizeObserver(() => o.notifyIntrinsicHeight!(document.body.scrollHeight));
      this.ro.observe(document.body);
    }
  }
}

/** Pick the adapter for the host we're running in. */
export function createHost(): HostAdapter {
  return windowOpenai() ? new SkybridgeHost() : new ExtAppsHost();
}
