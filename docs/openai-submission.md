# OpenAI / ChatGPT app-directory submission runbook

Operational checklist and reviewer materials for submitting the Graffiticode MCP
server to OpenAI's app directory (Apps SDK, `platform.openai.com/plugins`) as a
**With MCP → app-plus-skills** submission.

**Status (2026-09-15).** v1.0.0 was **approved 2026-08-14**. v2.0.0 was **rejected
2026-08-30** — "one or more test cases did not produce correct results." No resubmission has
been filed. What changed since the rejection is recorded in §10; read it before reusing any
checklist below, because two things the reviewer sees are different now (ChatGPT gets a
widget, and the expected tool-call path is shorter).

- **Publisher:** Artcompiler (business identity verification).
- **MCP endpoint:** `https://mcp.graffiticode.org/mcp` (Streamable HTTP).
- **UI: OpenAI clients now get the native inline widget** (2026-08-31 `dd8f67e`, corrected
  2026-09-11 `365e406`). `render_item` and `get_item` carry it; `create_item`/`update_item` do
  not (they return `generating`). **Which route an OpenAI client takes depends on what it
  declares, not on its name alone** (`widgetRouteFor` in `src/tools.ts`):
  - declares `io.modelcontextprotocol/ui` → **`mcp-apps`**, the same ext-apps contract Claude
    gets. Codex v0.153.4 declares `[io.modelcontextprotocol/ui, openai/form]` and lands here.
  - does not declare it → **`openai`**, `_meta["openai/outputTemplate"]` and the Skybridge
    contract, admitted on the name allow-list `/openai|chatgpt|codex/i`.

  Declaring is **necessary but not sufficient**: `web-sandbox`-style clients declare the
  extension too and still get text, pinned by `tools-contract.test.ts`. Note the route is
  nearly cosmetic — the OpenAI key set is additive rather than route-exclusive, so the metadata
  every observed client receives is byte-identical before and after that change. What actually
  fixed Codex's blank card was the **transport**: `createHost` used to guess
  (`window.openai ? Skybridge : ExtApps`), commit to the guess, and spin forever against a
  global the host never populates. `RacingHost` now asks both and keeps whichever answers
  first. A mount that draws nothing falls back to the content card, and the fallback now says
  so on screen (`f5759be`) instead of only in a console nobody has open.

  **The submission therefore has a UI surface**: the portal imports it at Scan Tools, and UI
  screenshots are in scope. CSP declares `resourceDomains` only (`widgetCsp()` in
  `src/widget/index.ts`) — no `frameDomains` (the OpenAI review flag), no `connectDomains`.
  **Which route ChatGPT's consumer app takes is still unobserved** — production has only ever
  logged `codex-mcp-client` and `openai-mcp`. Check the `[widget] tools/list` log line during
  the review window and record it here.
- **Legal:** privacy `https://mcp.graffiticode.org/privacy`, terms
  `https://mcp.graffiticode.org/terms`, support `support@graffiticode.org`.
- **Listing copy:** [`openai-listing-copy.md`](./openai-listing-copy.md) is the canonical,
  versioned source for every public publisher field (category, tagline, description, starter
  prompts). The portal is **not** the source of truth — change both in the same sitting.

---

## 0. OAuth go/no-go gate (decide BEFORE creating the draft)

> **DECIDED (2026-07-16): v1 is `noauth`-only.** Tools advertise `{ type: "noauth" }`
> only (`TOOL_SECURITY_SCHEMES` in `src/tools.ts`); do **not** configure an OAuth
> connection in the portal. OAuth ships in a later reviewed update once item 2c-vi lands.

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

## 3. Domain verification — **DONE**

> **Completed for v1 (approved 2026-08-14). `mcp.graffiticode.org` stays verified across
> versions — do not go chasing this again.** The procedure is kept only in case the host
> changes or the portal asks for re-verification.

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
      connection + fresh conversation.
- [ ] **A person has watched the widget mount in ChatGPT web AND mobile**, on all three
      starter prompts. Partly satisfied: on 2026-09-11 an L0173 chart was seen drawing in the
      **ChatGPT mobile app** — the first confirmed OpenAI-host render. The same item **fell
      back to the content card in ChatGPT desktop**, with the same client name, the same
      advertised metadata and the same bundle fetched 200 in both. The transport fix
      (`365e406`) explains and fixes **Codex's** blank card; it does not explain the desktop
      fallback, which is still open (§10). Since the reviewer tests both surfaces, this gate
      is not met until desktop is seen rendering. jsdom is not a substitute — it cannot render
      L0173 at all (ECharts needs a canvas it lacks).
- [ ] A **"Generating…" card is expected now, and is not a defect.** It carries a live
      progress line (elapsed + tokens written) and is replaced in place when the item is
      ready. What must NOT appear is a stack of them: `render_item` gives ChatGPT the
      terminal's 15s leash rather than Claude's 8s for exactly this reason (`src/tools.ts`,
      `TERMINAL_POLL_DEADLINE_MS`). Count the cards on a slow generation.
- [ ] Claude regression smoke (native widget still renders).
- [ ] If OAuth: connect end-to-end using the **exact redirect URI ChatGPT registers**.

---

## 6. Test cases — exactly 5 positive + 3 negative (OpenAI requires this count)

Expected creation path: **`create_item → render_item`**. This changed on 2026-09-01
(commit `7a88c67`): `SERVER_INSTRUCTIONS` now carries the language catalog inline and tells the
model to call `create_item` DIRECTLY for a clear request, because `list_languages` +
`get_language_info` cost ~14s before any work starts. Discovery calls are still correct for an
unclear request — `npm run eval:routing` measures them per case (`[disc 0,0,0]` means every run
routed without one). **Do not describe the old four-call path to a reviewer**; they would read
its absence as a failure.

Generation is asynchronous: **the first `render_item` may return `generating`** — that is
expected. Reviewer instruction: *if `render_item` returns `generating`, wait and call
`render_item(item_id)` again; it returns progress (elapsed seconds and tokens written) each
time.* Timing measured against production on 2026-09-15, create→ready: **13.0s (L0179 invoice),
9.7s (L0169 concept web), 7.4s (L0176 Learnosity pair)**. Larger items are much slower — a
15,000-token L0179 sheet took 149s on 2026-08-31 — so keep the "allow up to ~3 minutes"
instruction; just do not tell a reviewer 60–110s is typical, because for storefront-sized
content it is not.

A finished result is a compact text summary (with the item's contents and an "Open in
Graffiticode" markdown link, in both `content` and `structuredContent`) **plus the inline
widget on ChatGPT** — see the UI note at the top of this file. Since 2026-09-11 (`5271031`)
that summary's link directive is **host-aware**: a client that mounts the widget is told the
item is already rendered and not to reproduce it, because ChatGPT was printing the sheet twice
— once as the live grid, once as a markdown table the model transcribed because it had been
asked to. A terminal client still gets the "show the contents AND the link" directive.

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
   `securitySchemes`. Confirm the portal imports the **widget on `render_item` and `get_item`**
   (`openai/outputTemplate`) and on nothing else. Provide the **smallest CSP the portal
   permits** — ours declares `resourceDomains` only; if the portal offers `frameDomains`, leave
   it EMPTY. Inspect the imported snapshot: the resource URI is content-hashed, so a stale hash
   in the snapshot means the portal cached a previous build.
6. Upload the **skill bundle** (§2).
7. Add listing copy, starter prompts, the exact **5+3** tests (§6), availability, release
   notes. **UI screenshots are now in scope** — capture them from ChatGPT, not Claude, and only
   from a render a person has actually watched mount.
8. **Freeze metadata** after the final successful Scan Tools (schema/annotation/description/
   security-scheme changes force a version resubmission).
9. On approval, click **Publish** (apps do not auto-list).

---

## 10. What changed since the v2.0.0 rejection (2026-08-30)

The rejection said only "one or more test cases did not produce correct results." The
reviewer's 2026-08-29 17:42–18:02 UTC session (they ran `openai-mcp` and `openai-mcp (Codex)`
in alternating pairs) gave three findings. Their status:

| Finding | Status |
|---|---|
| A concept-web request rerouted L0169 → L0166 (deprecated), because the scope gate classified on `get_spec` output pasted under the instruction rather than on the instruction | **Fixed** 2026-08-31 — the classifier splits the ask from source material |
| Of the 5 positive test cases, **only 2 and 4 left any server trace**. Test 1 (flashcards) and test 3 (generic quiz) never reached us — consistent with the generic-quiz routing gap | **Mitigated, not proven.** L0180 (ungated general assessment) registered 2026-09-01, and `eval:routing` now asserts the quiz cases *reach* a language (`expectReachable`) instead of only that they avoid Learnosity — the old assertion was satisfied by calling nothing, so it was green precisely while the gap was open. Logs still cannot distinguish "reviewer skipped" from "ChatGPT declined to call us" |
| Starter prompt 1 was recorded against L0166, deprecated 2026-08-26 — eight days AFTER the v2 submission | **Fixed** 2026-09-15 — re-verified against L0179; see `openai-listing-copy.md` |

Also changed, and material to a reviewer:

- **ChatGPT now gets the widget** (2026-08-31) — see the UI note at the top.
- **Tool results are self-sufficient in `structuredContent`** (2026-09-04) — Claude Code and
  Cowork drop `content[0].text` for any tool with an `outputSchema`, so `summary` is carried in
  both; the item's contents and its link live there.
- **Progress is reported** (2026-09-09) — elapsed seconds and tokens written, in the tool
  result and on the widget's Generating card.
- **Codex renders** (2026-09-11, `45e7138`) — the host transport is raced instead of guessed,
  the mcp-apps route opens to a declaring OpenAI client, a failed native mount says so on
  screen, and widget hosts are no longer told to reprint the item they just drew.
- **Latency** — the 149s outlier traced to `claude-sonnet-5` running adaptive thinking with
  `thinking` omitted; `CODEGEN_EFFORT` exists as an env passthrough but was measured and
  **rejected** (real quality cost, no latency win above noise). Do not set it for a review
  window.

**Still open before resubmitting:**

1. **ChatGPT desktop fell back to the content card** on 2026-09-11 while ChatGPT mobile drew
   the same L0173 chart — same client name, same metadata, bundle 200 in both. The transport
   race fixed Codex; this one has no explanation on record. It is the highest-value thing to
   reproduce before resubmitting, because the reviewer runs both surfaces and a card where a
   chart belongs is exactly "did not produce correct results". The fallback note (`f5759be`)
   and the element `title` now distinguish "threw" from "mounted and drew nothing" — read
   them on the next desktop repro rather than starting from logs.
2. **A person has still not watched all three starter prompts render** on either OpenAI
   surface — one chart on mobile is the whole of the evidence. §5 gate.
3. **`list_languages(search: "invoice")` returns nothing**, as does any word the catalog's
   keywords miss. Starter prompt 1 routes correctly anyway (3/3 on the inlined catalog), but a
   reviewer who searches before creating gets an empty result. The keyword index lives in the
   console, not this repo.
4. **L0169's `render_item` summary is empty** — a concept web returns a link and a title and no
   description of its contents, where L0179 and L0176 both describe theirs. On ChatGPT the
   widget covers this; on a terminal client it does not.
5. The v3 copy gaps in `openai-listing-copy.md` (L0177/L0178 invisible; the `learnosity`
   indexing experiment).
