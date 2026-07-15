/**
 * Host adapter — the one seam between the shared renderer and the two hosts.
 *
 * Claude (and other MCP Apps hosts) speak the ext-apps `App` bridge; ChatGPT
 * speaks `window.openai` (Skybridge). The renderer is written once against this
 * interface; each host gets a thin adapter. This is what lets a single native
 * renderer serve both, instead of the two drifting widgets we had before.
 *
 * ext-apps is loaded from esm.sh at runtime (only on the Claude path), not bundled,
 * so the inlined shell stays tiny — and ChatGPT (Skybridge) never loads it.
 *
 * Not compiled by tsc (browser-only) — bundled by scripts/build-widget.mjs.
 */

// Injected by the HTML generator: the esm.sh URL for @modelcontextprotocol/ext-apps.
declare const __EXT_APPS__: string;

// Minimal shape of the bits of the ext-apps App we use (it's loaded dynamically).
interface ExtApp {
  ontoolresult?: (params: { structuredContent?: unknown; _meta?: unknown }) => void;
  onhostcontextchanged?: (ctx: { theme?: string }) => void;
  connect(): Promise<void>;
  getHostContext(): { theme?: string } | undefined;
  openLink(p: { url: string }): Promise<unknown>;
  sendMessage(p: { role: "user"; content: Array<{ type: "text"; text: string }> }): Promise<unknown>;
}

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

/** MCP Apps host (Claude et al.), wrapping the ext-apps App class (loaded from
 * esm.sh in connect(), so it's not bundled and ChatGPT never fetches it). */
class ExtAppsHost implements HostAdapter {
  private app?: ExtApp;
  private toolCb?: (r: ToolResult) => void;
  private themeCb?: (t: string | undefined) => void;

  onToolResult(cb: (r: ToolResult) => void): void {
    this.toolCb = cb;
  }

  onTheme(cb: (t: string | undefined) => void): void {
    this.themeCb = cb;
  }

  async connect(): Promise<void> {
    const { App } = (await import(/* @vite-ignore */ __EXT_APPS__)) as {
      App: new (o: { name: string; version: string }) => ExtApp;
    };
    const app = new App({ name: "graffiticode-form", version: "1.0.0" });
    // Register handlers before connect so an early notification isn't missed.
    app.ontoolresult = (params) =>
      this.toolCb?.({
        structuredContent: (params.structuredContent ?? {}) as Record<string, unknown>,
        meta: (params._meta ?? {}) as Record<string, unknown>,
      });
    app.onhostcontextchanged = (ctx) => this.themeCb?.(ctx.theme);
    this.app = app;
    await app.connect();
    this.themeCb?.(app.getHostContext()?.theme);
  }

  openLink(url: string): void {
    this.app?.openLink({ url }).catch(() => window.open(url, "_blank", "noopener"));
  }

  sendMessage(text: string): void {
    this.app?.sendMessage({ role: "user", content: [{ type: "text", text }] }).catch(() => {
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
    // Skybridge exposes the result on a global rather than an event; the connect()
    // poll delivers it once it's populated.
  }

  onTheme(cb: (t: string | undefined) => void): void {
    const o = windowOpenai();
    cb(o?.theme as string | undefined);
    // Skybridge re-renders the iframe on theme change, so a one-shot read suffices.
  }

  async connect(): Promise<void> {
    // Wait for window.openai + a populated tool result (generation may still be
    // running when the widget first mounts).
    for (let i = 0; i < 120; i++) {
      const r = this.read();
      if (r) {
        this.toolCb?.(r);
        return;
      }
      await new Promise((res) => setTimeout(res, 500));
    }
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
