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
