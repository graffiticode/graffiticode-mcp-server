# Outstanding issues

## Web-chat hosts ignore widget `frameDomains` → inline form iframe is blocked

**Status:** open (2026-07-14). Rendering is ADAPTIVE: the widget still embeds the
inline iframe (desktop apps honor `frameDomains` and render inline), and falls back
to an "Open in Graffiticode" CTA only when the host blocks the frame — detected via
the `securitypolicyviolation` event (web hosts), with a load/timeout safety net.
See `src/widget/browser/claude-app.ts` and `src/widget/form-widget.ts`.

**Desktop vs web:** Claude/ChatGPT **desktop** apps DO honor declared `frameDomains`
and render the form inline. The **web** apps apply the hardcoded `frame-src` below
and get the CTA fallback.

**Symptom.** Rendering a Graffiticode form inline in claude.ai or chatgpt.com (web)
shows the browser's "This content is blocked. Contact the site owner to fix the
issue." placeholder where the form should be.

**Root cause.** The widget embeds a cross-origin iframe pointing at the item
renderer (`api.graffiticode.org/form?…` → 302 → `l<NNNN>.graffiticode.org/form`).
Both hosts apply a **hardcoded sandbox CSP `frame-src`** that ignores the
`frameDomains` we declare in the MCP-Apps widget CSP, so the iframe is blocked:

| Host        | Applied `frame-src`      | Reads our declared frame hosts? |
|-------------|--------------------------|---------------------------------|
| Claude      | `'self' blob: data:`     | No (`_meta.ui.csp.frameDomains`) |
| ChatGPT web | `'none'`                 | No (`openai/widgetCSP.frame_domains`) |

Confirmed via the browser console on both hosts:
`Framing 'https://api.graffiticode.org/' violates the following Content Security
Policy directive: "frame-src …". The request has been blocked.`

**Our side is correct and not the cause.** The renderers and `api.graffiticode.org`
send `Cross-Origin-Resource-Policy: cross-origin` (no `X-Frame-Options` /
`frame-ancestors`), and the MCP server declares the CSP per the ext-apps spec
(`text/html;profile=mcp-app`, csp on the resource content item's `_meta.ui.csp`
with the right `frameDomains`). The block is host-side.

## ChatGPT web: "Failed to fetch template" — widget template-pointer collision

**Status:** open (2026-07-14). ChatGPT web fails to load the widget with
"Error loading app — Failed to fetch template"; console shows
`GET …/backend-api/ecosystem/widget?…template_pointer=ui://graffiticode/claude-form-widget.html… 404`.

**Cause.** Each tool's `_meta` declares BOTH `openai/outputTemplate` (→ the
Skybridge widget `form-widget.html`, `text/html+skybridge`) AND `ui.resourceUri`
(→ the MCP-Apps widget `claude-form-widget.html`, `text/html;profile=mcp-app`).
ChatGPT now reads the MCP-Apps `ui.resourceUri` as the `template_pointer`, but
fetches it through its **Skybridge** `/ecosystem/widget` endpoint, which can't serve
the `text/html;profile=mcp-app` resource → 404. (Also a known ChatGPT-side
regression — OpenAI community "ecosystem/widget 404 … ongoing since late May".)
Independent of the widget-content edits; it's about the `_meta` template pointers.

**Fix options (not yet applied — needs a decision + ChatGPT re-test):**
- **Content-negotiate one URI (durable):** capture `clientInfo.name` at `initialize`,
  set `ui.resourceUri` = `openai/outputTemplate` = one URI, and in `resources/read`
  return `text/html+skybridge` (+ `window.openai` widget) for ChatGPT vs
  `text/html;profile=mcp-app` (+ ext-apps `App` widget) for Claude. Resolves the
  collision cleanly.
- **Drop the `openai/*` Skybridge keys (experiment):** remove `openai/outputTemplate`
  / `openai/widgetCSP` / `openai/resultCanProduceWidget` so ChatGPT treats the tool
  as pure MCP-Apps and loads `ui.resourceUri` via the MCP-Apps bridge (not the
  404ing Skybridge endpoint). Low risk (ChatGPT is already broken), but a bet.

**What still needs doing / to revisit**
1. **Re-enable inline framing** once a host honors server-declared `frameDomains`.
   Restore the iframe path in the two widget files (guarded by a working-frame
   detection or per-host capability).
2. **ChatGPT-specific:** verify whether the correct `openai/widgetCSP` shape/field
   (e.g. `resource_domains` vs `frame_domains`, tool-result vs resource placement)
   makes ChatGPT honor it — its `'none'` default suggests our declaration may not
   be read. If fixable, ChatGPT could get true inline rendering while Claude keeps
   the CTA.
3. Track upstream: MCP Apps spec (SEP-1865) defines `frameDomains`; hosts do not
   yet enforce it for third-party origins.
