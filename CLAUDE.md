# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm run build         # Compile TS to dist/ (tsc) + bundle the MCP Apps widget (esbuild)
npm run build:widget  # Bundle only the widget (src/widget/browser → dist/widget/claude-app.bundle.js)
npm run clean         # Remove dist/ directory
npm run start         # Run Streamable HTTP server (reads PORT env, defaults to 3001)
npm run gcp:build     # Deploy to Google Cloud Run via Cloud Build
npm run gcp:deploy    # Deploy from source to Cloud Run (mcp-service, us-central1)
npm run gcp:logs      # View Cloud Run logs
```

## Testing / debugging

There is no unit-test suite. Two **eval harnesses** stand in for one; both hit a
live console and cost real API calls, so run them deliberately, not on every edit.

```bash
# Routing eval: does a model pick the RIGHT language for a prompt?
ANTHROPIC_API_KEY=… GRAFFITICODE_API_KEY=… npm run eval:routing
ANTHROPIC_API_KEY=… GRAFFITICODE_API_KEY=… npm run eval:routing -- --catalog-only

# Cross-language eval: exercises the get_spec adoption path end-to-end
GRAFFITICODE_API_KEY=… npx tsx scripts/eval-cross-language.ts
```

`scripts/eval-routing.ts` puts a real model in front of the real agent-facing surface
(`SERVER_INSTRUCTIONS` + the live `list_languages`/`get_language_info` schemas and handlers,
plus SKILL.md bodies read from a local `../graffiticode-skills` checkout — override with
`GRAFFITICODE_SKILLS_PATH`) and asserts which `language` it passes to a stubbed `create_item`.
Nothing is generated. It exists to lock down a specific regression: prompts that merely
*mention* an assessment ("a 5-question quiz on the water cycle") routing to the **vendor-gated**
Learnosity languages (L0158/L0176), which may only be chosen when the user names Learnosity.
Routing is stochastic, so each case runs N times (`EVAL_RUNS`, default 3) — a 1-of-N failure is
still a regression. **Run this after touching `SERVER_INSTRUCTIONS`, tool descriptions, the
language catalog, or the skills repo** — those are exactly the inputs it guards.

For manual testing, the standard tool is the **MCP Inspector** — the official MCP server
testing/debugging app (`npx @modelcontextprotocol/inspector`). When the user says "the
inspector" or "the MCP test app", they mean this. Point it at the running server
(`npm run start`, default `http://localhost:3001/mcp`, Streamable HTTP transport) to exercise
tools, resources, and the MCP Apps widget.

## Architecture

This is a thin-router MCP server for Graffiticode. It provides a fixed set of language-agnostic tools that route to language-specific backends. The client specifies which language to use; all language expertise lives in the backend.

```
┌─────────────────────────────────────────────────────────────────────┐
│  MCP Server (thin router)                                           │
│  Tools: create_item, update_item, get_item, get_spec,               │
│         list_languages, get_language_info                           │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Graffiticode API → Language-specific backends                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Entry Points

- **`src/server.ts`** - Streamable HTTP transport for hosted deployments. Auth via `Authorization: Bearer <api-key>` header, OAuth 2.1 access token, or no auth at all (free-plan path: server forwards calls to console with `X-Free-Plan-Session: <mcp-session-id>` instead). Endpoint: `/mcp`

### Core Modules

- **`src/api.ts`** - GraphQL client for Graffiticode API. All language discovery and code generation is backend-driven. Defines `AuthContext`, the value threaded through every handler: `{ type: "firebase", token, source: "oauth" | "raw" }` or `{ type: "freePlan", sessionId }`. `buildAuthHeaders` turns the former into `Authorization: Bearer` and the latter into `X-Free-Plan-Session`. There is **no** `src/auth.ts` and no Firebase custom-token/ID-token exchange in this repo — `resolveBearer()` in `server.ts` classifies the incoming bearer and the console does the rest.
- **`src/render-token.ts`** - Exchanges a raw Graffiticode API key for a short-lived (5-min) ES256 access token via the auth service's `/authenticate/api-key`, cached per key and de-duped in flight. This is what goes in the widget's `form_url`. **Never embed the raw API key there** — `api.graffiticode.org` only accepts JWTs, so a raw key 401s → falls back to anonymous → 404s on private tasks, *and* leaks a permanent credential into URLs and request logs.
- **`src/events.ts`** - Structured funnel events (`mcp_connect`, `mcp_tool`) emitted as one JSON line per event to stdout → Cloud Logging, aggregated by the console's `scripts/mcp-funnel-report.ts`. Instrumentation is best-effort and must never break a request. The privacy contract is load-bearing and asserted in the user-facing copy: never log raw prompts (only `desc_len`), never log raw session UUIDs or bearer tokens (only a one-way hash), never log the client IP (only coarse `CF-IPCountry` geo). The free-plan session hash reuses `deriveSessionNamespace` so the logged `session` joins to what the console stamps on items and claims.
- **`src/tools.ts`** - MCP tool definitions and handlers. Routes requests to backend based on language parameter.
- **`src/resources.ts`** - MCP resource handlers: per-language user guides, and **agent skills** discovered at request time from the public `graffiticode-skills` GitHub repo (each top-level dir = one skill `<id>/SKILL.md`, exposed as `graffiticode://skills/<id>`). Catalog is fetched via the GitHub contents API + raw content, cached ~60s (stale-while-revalidate). Adding a skill to that repo surfaces it with no rebuild/redeploy; nothing is vendored into this repo.
- **`src/oauth/`** - OAuth 2.1 + PKCE for hosted mode: dynamic client registration, authorize/callback/token endpoints, Firestore-backed store. Hosted auth accepts either an OAuth access token or a raw Graffiticode API key as the Bearer credential.
- **`src/widget/`** - Inline-rendering widgets exposed as MCP resources and linked from tool `_meta` (`openai/outputTemplate` for ChatGPT Apps; nested `ui.resourceUri` + legacy `ui/resourceUri` for the official MCP Apps standard, mimeType `text/html;profile=mcp-app`). When the result carries `_meta.form_url` the widget embeds it in an iframe; otherwise it shows a claim-CTA card (see below).
  - `claude-widget.ts` generates the MCP Apps HTML; the interactive logic is `browser/claude-app.ts`, which uses the ext-apps `App` class (JSON-RPC/postMessage `ui/initialize` handshake, `ontoolresult`, host-context theme, auto-resize). `browser/` is excluded from `tsc` and bundled to `dist/widget/claude-app.bundle.js` by `scripts/build-widget.mjs` (esbuild), then inlined into the resource HTML at runtime.
  - `form-widget.ts` is the ChatGPT/Skybridge variant (`window.openai`, `text/html+skybridge`).
  - Server (`server.ts`) advertises the `io.modelcontextprotocol/ui` extension capability and serves the MCP Apps resource with `_meta.ui.csp` (frame/connect domains for api + app hosts).

### Implementation notes

- **Conversation history.** `update_item` reads the item's `help` field (JSON array of prior user messages), builds a contextual prompt from the last 6 entries plus current `src`, calls `generateCode`, then appends a new entry and writes the updated array back. Iterative edits depend on this round-trip — don't drop the `help` write.
- **Language ID normalization.** Clients may pass `L0166` or `0166`; handlers strip the leading `L` before calling the API, and responses re-add it.
- **`create_item` flow.** Creates an empty item from the language template, then delegates to `handleUpdateItem` with the user's description — so template seeding and first-turn generation share one code path.
- **Inline-render URL (`_meta.form_url`).** `buildFormUrl(auth, …)` in `tools.ts` puts a render URL on the tool result's `_meta` (widget-only, hidden from the model) **only for authenticated (firebase) items** — `${API_URL}/form?lang=&id=<taskId>&access_token=<token>` — which the widget iframes. The `access_token` is the 5-min ES256 token from `render-token.ts`, never the raw API key. Free-plan items are session-scoped (namespaced by `X-Free-Plan-Session`) and aren't readable by an auth-less iframe, so they get **no** `form_url`; the widget falls back to a claim-CTA card from `view_url`/`claim_url`/`claim_message`. `view_url` (`${APP_URL}/form/<itemId>`, via `buildViewUrl`) is always set as the "Open in Graffiticode" link.

### MCP Tools (fixed set, language-agnostic)

| Tool | Purpose |
|------|---------|
| `create_item(language, description)` | Create item in any language (async; returns `status: "generating"`) |
| `update_item(item_id, modification)` | Update item (language auto-detected; async) |
| `get_item(item_id)` | Retrieve item by ID (long-polls to completion) |
| `get_spec(item_id)` | Platform-neutral English spec — the only sanctioned cross-language bridge |
| `list_languages(domain?, search?)` | Discover available languages |
| `get_language_info(language)` | Get language docs, examples, React usage |

### User-facing docs

The privacy and terms pages exist **twice**: as hardcoded HTML template literals in
`src/server.ts` (`PRIVACY_HTML`, `TERMS_HTML`, `ABOUT_HTML` — these are what users
actually read at `/privacy`, `/terms`, `/about`) and as `PRIVACY.md` / `TERMS.md`.
**They are matched pairs — change both together.** They previously drifted: the
markdown gained a "Usage Analytics" section that the served page never got.

Anything asserted in the privacy copy must trace to real behavior: `src/events.ts`
for what is logged (metadata only; never the prompt, never the client IP) and
`src/oauth/firestore-store.ts` for what is persisted (OAuth records include the
user's email plus access/refresh tokens). Also keep the tool list in sync in three
places: `ABOUT_HTML`, `MCP_DISCOVERY`, and `README.md`.

### Environment Variables

- `GRAFFITICODE_CONSOLE_URL` - Console GraphQL API endpoint (default: `https://console.graffiticode.org/api`). Note this ends in `/api`.
- `GRAFFITICODE_CONSOLE_BASE_URL` - Console bare host used to build user-facing claim URLs (default: `https://console.graffiticode.org`).
- `GRAFFITICODE_API_URL` - Graffiticode API host. Serves language templates and the token-authenticated `/form` render endpoint the inline widget embeds for signed-in users (default: `https://api.graffiticode.org`).
- `GRAFFITICODE_APP_URL` - App host used to build user-facing item view links (`/form/<id>`) (default: `https://app.graffiticode.org`).
- `GRAFFITICODE_AUTH_URL` - Auth endpoint (default: `https://auth.graffiticode.org`).
- `GRAFFITICODE_SKILLS_REPO` - Public GitHub repo (`owner/name`) discovered at request time to serve agent skills as MCP resources (default: `graffiticode/graffiticode-skills`).
- `GRAFFITICODE_SKILLS_REF` - Git ref/branch for skill discovery (default: `main`).
- `GRAFFITICODE_SKILLS_TTL_MS` - Skill catalog cache TTL in ms (default: `60000`).
- `FREE_PLAN_NAMESPACE_SALT` - Shared HS256 secret used to mint trial-claim JWTs. **Must be the identical value the console deploys with** — both come from the same Secret Manager entry populated by the console's `scripts/set-free-plan-secrets.sh`. Mount on Cloud Run with `gcloud run services update mcp-service --update-secrets=FREE_PLAN_NAMESPACE_SALT=FREE_PLAN_NAMESPACE_SALT:latest`. If unset, trial responses still succeed but omit `claim_url`/`claim_message` (single warning logged at startup).
- `PORT` - HTTP server port (default: 3001).

### Trial-claim JWT (free-plan only)

Free-plan `create_item` and `update_item` responses include three extra fields so the user can transfer the item into a real Graffiticode account on first sign-in:

- `view_url` — `${APP_URL}/form/<id>`
- `claim_url` — `${CONSOLE_URL}/claim?token=<jwt>`
- `claim_message` — chat-friendly string surfacing the URL

The JWT contract (defined in `src/claim-token.ts` and verified by the console at `console/src/lib/claim-token.ts`):

- HS256, secret = `FREE_PLAN_NAMESPACE_SALT` (UTF-8 bytes)
- Audience: `graffiticode-claim`
- Expiry: 24h
- Payload: `{ sessionNamespace, sessionUuid }` where `sessionNamespace = sha256(salt + ":" + sessionUuid)`

The `sessionUuid` comes from the MCP transport's session id (set during the MCP `initialize` POST and read off the free-plan auth context as `auth.sessionId`).
