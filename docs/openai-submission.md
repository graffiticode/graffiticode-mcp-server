# OpenAI / ChatGPT app-directory submission runbook

Operational checklist and reviewer materials for submitting the Graffiticode MCP
server to OpenAI's app directory (Apps SDK, `platform.openai.com/plugins`) as a
**With MCP → app-plus-skills** submission.

- **Publisher:** Artcompiler (business identity verification).
- **MCP endpoint:** `https://mcp.graffiticode.org/mcp` (Streamable HTTP).
- **UI:** none on ChatGPT by design — ChatGPT (web/desktop/mobile) and every non-Claude
  client get a compact text result plus an "Open in Graffiticode" link. No widget, no UI
  screenshots. (Claude keeps a native inline widget; that is a separate host.)
- **Legal:** privacy `https://mcp.graffiticode.org/privacy`, terms
  `https://mcp.graffiticode.org/terms`, support `support@graffiticode.org`.

---

## 0. OAuth go/no-go gate (decide BEFORE creating the draft)

The optional OAuth surface is hardened server-side **except** one cross-service item:
the consent page still returns the Google ID token in the `/oauth/callback` **query
string** (see `src/oauth/handlers.ts` `handleCallback`), which can leak into history/logs.
Fixing it needs a coordinated change in the console/auth consent service.

- **If that change has landed:** submit **with OAuth** (optional auth). Provide reviewer
  credentials (below).
- **If not:** submit **v1 as `noauth`-only** — in the portal, do not configure the OAuth
  connection; the tools still advertise `{ type: "noauth" }` and work anonymously (free
  plan). Add OAuth in a later reviewed update. **Never advertise a partially-hardened OAuth
  surface.**

Anonymous write tools are safe to expose (state this to reviewers): they operate only in an
**isolated free-plan session**, expose **no customer account data**, claiming created
content **requires sign-in**, and OAuth (when enabled) associates later work with an account.

---

## 1. Prerequisites (start immediately, in parallel with code)

- [ ] Artcompiler **business identity verification** complete in the Platform Dashboard.
- [ ] Org owner has **`api.apps.write`** (draft/submit) and `api.apps.read`.
- [ ] Production is on the single-instance review config (see §5).

## 2. Skill bundle (app-plus-skills requires a skill ZIP)

Source: the public `graffiticode/graffiticode-skills` repo (same skills served as MCP
resources). Finalized skills: **`render`** (broad default-rendering preference — the primary),
**`assessments`**, **`learnosity`**. `forms` is **draft-only** (`SKILL.md.draft`) — finalize
or exclude it; do not ship a draft.

Checklist for the ZIP:
- [ ] Each included skill dir has a **final `SKILL.md`** (front-matter `name` + `description`
      with precise **trigger conditions**), no `.draft`.
- [ ] Referenced scripts/assets included; **no secrets**, no unnecessary permissions.
- [ ] The **exact file tree** matches what was tested locally.
- [ ] Language IDs inside skill copy are not stale (the catalog is dynamic — see §4).

## 3. Domain verification

OpenAI fetches the token from the **root of the registered host**
(`https://mcp.graffiticode.org/.well-known/openai-apps-challenge`; the `/mcp` path is
ignored). The apex `graffiticode.org` is only relevant if the portal explicitly asks for it
as the Challenge Base URL — confirm in-portal before assuming.

1. In the portal, obtain the challenge token.
2. Set it on the **already-tested image** (do not rebuild from an unverified tree):
   `gcloud run services update mcp-service --update-env-vars=OPENAI_APPS_CHALLENGE_TOKEN=<token>`
3. Verify: `curl https://mcp.graffiticode.org/.well-known/openai-apps-challenge` returns the
   **exact token and nothing else**, `Content-Type: text/plain`, `Cache-Control: no-store`.
4. Click verify in the portal. (The route 404s while the env var is unset.)

## 4. Tool + language facts to confirm at submission time

- Seven tools: `create_item`, `update_item`, `render_item`, `get_item`, `get_spec`,
  `list_languages`, `get_language_info`.
- **Re-confirm language IDs via `list_languages` immediately before submission** and record
  both the semantic language and the current ID in the test cases below (IDs below are
  illustrative — the catalog is dynamic).

---

## 5. Production-readiness gates (before "Submit for Review")

- [ ] Cloud Run **`min-instances=1` and `max-instances=1`** for the review window (the MCP
      transport keeps session state in-memory; multi-instance routing could 404 mid-session).
- [ ] `/health` reachable externally through Cloudflare.
- [ ] Full **5+3 run on ChatGPT web AND mobile** (desktop = extra coverage); fresh plugin
      connection + fresh conversation; **no "Generating…" widget** appears.
- [ ] Claude regression smoke (native widget still renders).
- [ ] If OAuth: connect end-to-end using the **exact redirect URI ChatGPT registers**.

---

## 6. Test cases — exactly 5 positive + 3 negative (OpenAI requires this count)

Expected creation path: **`list_languages → get_language_info → create_item →
render_item`**. Generation is asynchronous: **the first `render_item` may return
`generating`** — that is expected. Reviewer instruction: *if `render_item` returns
`generating`, wait and call `render_item(item_id)` again; typical completion is 60–110s, allow
up to ~3 minutes.* A finished result is a compact text summary plus an "Open in Graffiticode"
link (no inline UI on ChatGPT).

### Positive (must succeed)

1. **Flashcards.** Prompt: "Create a set of 8 flashcards for Spanish greetings (Hello/Hola,
   Goodbye/Adiós, …)." Path: `list_languages(search:"flashcard")` → `get_language_info` →
   `create_item` → `render_item`. Expect: `status:"ready"`, a flashcard language, view link.
2. **Spreadsheet.** Prompt: "Create a monthly budget spreadsheet with Category, Budgeted,
   Actual, Difference, rows for Rent/Groceries/Utilities, and a SUM totals row." Expect a
   spreadsheet language, `ready`, view link.
3. **General assessment (no vendor gate).** Prompt: "Create a 5-question quiz on the water
   cycle." Expect: routes to a **general** assessment language — **not** a vendor-gated
   (Learnosity) language — completes with a view link. (This is a success case.)
4. **Create then refine (self-contained).** Turn 1: "Create a concept-web assessment about
   photosynthesis with Photosynthesis at the center." Turn 2: "Add Chlorophyll as a connected
   concept and use a dark theme." Path: `create_item` → `render_item`, then `update_item` →
   `render_item`. Expect the second render reflects the change (conversation history applied).
5. **Cross-language via `get_spec` (self-contained).** Turn 1: create the spreadsheet from
   test 2. Turn 2: "Make flashcards from that spreadsheet's contents." Path: `get_spec(item_id
   of the spreadsheet)` → `create_item(flashcard language, spec text)` → `render_item`. Expect
   a flashcard item derived from the spec (not from raw src/data).

### Negative (must be safely refused / redirected)

1. **Vendor-gated without entitlement.** Prompt (user-facing, reproducible): "Make this in
   Learnosity." with no Learnosity context/account. Expect: the assistant explains the
   Learnosity languages are vendor-gated / asks permission to use a general alternative —
   it does **not** silently produce a Learnosity item. (Guarded by `npm run eval:routing`.)
2. **Out of catalog.** Prompt: "Book me a flight to Tokyo." Expect: states what Graffiticode
   does and declines/asks — does **not** force an unrelated language.
3. **Raw cross-language handle.** Prompt: paste an `item_id` (or raw AST/src) into a request
   to create in another language. Expect: refused, with a redirect to `get_spec` as the
   sanctioned bridge.

### Tool-annotation notes (for the reviewer)

- `create_item`: `readOnlyHint:false`, `destructiveHint:false`, `openWorldHint:true`.
  Created items are publicly viewable via their `view_url` (hence open-world); creation
  destroys nothing.
- `update_item`: `readOnlyHint:false`, `destructiveHint:**true**`, `openWorldHint:true`.
  It **replaces the item's content in place**; the platform's revert is not exposed through
  MCP and the ChatGPT flow is anonymous, so a user cannot practically restore prior content
  through this surface — marked destructive accordingly. (Will flip to non-destructive in a
  reviewed update once revert is surfaced via MCP.)
- Retrieval/discovery tools (`render_item`, `get_item`, `get_spec`, `list_languages`,
  `get_language_info`): `readOnlyHint:true`.

---

## 7. Reviewer OAuth instructions (only if submitting with OAuth)

- Auth is **optional**; anonymous free-plan use exercises every tool without linking.
- To test authenticated flow: connect via the standard OAuth 2.1 + PKCE(S256) flow; DCR is
  supported (the connector registers its own client + `https://chatgpt.com/connector/oauth/…`
  redirect). Access tokens are short-lived (55 min) and rotate on refresh; an expired/revoked
  token returns a `401` + `WWW-Authenticate` (and, inside a tool call, a
  `_meta["mcp/www_authenticate"]` challenge) prompting reconnection.
- Provide a reviewer Google account authorized to Graffiticode if account-scoped behavior is
  part of the test set; otherwise the anonymous path suffices.

## 8. Privacy statement (accurate wording)

Tool responses contain **no account access tokens, refresh tokens, API keys, passwords, or
debug credentials.** Free-plan responses do include a 24-hour, single-purpose **claim
capability token** in `claim_url` (it transfers anonymous items into an account on first
sign-in and carries no personal data). Logs are metadata-only: never the prompt (only its
length), never raw session UUIDs or bearer tokens (only one-way hashes), never the client IP
(only coarse country/region). OAuth records persist the authorized Google email plus
access/refresh tokens through the auth service.

## 9. Portal submission steps

1. Resolve the **OAuth go/no-go** (§0).
2. Create **With MCP** submission; endpoint `https://mcp.graffiticode.org/mcp`.
3. Configure OAuth + reviewer creds **only if** submitting with OAuth.
4. Domain-verify (§3).
5. **Scan Tools** → confirm **7 tools**, correct input/output schemas, annotations, and
   `securitySchemes`; confirm **no linked ChatGPT UI**. Provide the **smallest CSP the portal
   permits**. Inspect the imported snapshot.
6. Upload the **skill bundle** (§2).
7. Add listing copy, starter prompts, the exact **5+3** tests (§6), availability, release
   notes. Submit **without UI screenshots**.
8. **Freeze metadata** after the final successful Scan Tools (schema/annotation/description/
   security-scheme changes force a version resubmission).
9. On approval, click **Publish** (apps do not auto-list).
