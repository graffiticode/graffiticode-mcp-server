# OpenAI / ChatGPT app-directory submission runbook

Operational checklist and reviewer materials for submitting the Graffiticode MCP
server to OpenAI's app directory (Apps SDK, `platform.openai.com/plugins`) as a
**With MCP → app-plus-skills** submission.

> **Where we are right now: [`listing-refresh-status.md`](./listing-refresh-status.md)** — the
> pick-up-here document. It holds the critical path, the decisions owed, what is verified and
> what is not. This file is the procedure; that one is the state.

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

## 2. Plugin package (the ZIP is built, not assembled by hand)

Source: the public `graffiticode/graffiticode-skills` repo (same skills served as MCP
resources). Built with **`npm run package`** there — `scripts/build-plugin.mjs`. Served
skills as of 2026-09-17: **`render`** (broad default-rendering preference — the primary),
**`assessments`**, **`learnosity`**. `forms` is held (`SKILL.md.draft`) and the build excludes
it automatically.

The package is an **Agent Plugins 1.0.0** tree — a generated `plugin.json` at the root plus
`skills/<id>/SKILL.md`. Note the shipped layout is NOT the repo's: skills live at the repo's
top level because the MCP server discovers them there at request time, and the build restages
them. `plugin.json`'s `interface` block **is** the listing (display name, subtitle, long
description, category, starter prompts); it is generated from `plugin.meta.json` in that repo,
whose human-readable counterpart is `openai-listing-copy.md`.

```bash
cd ../graffiticode-skills
npm run package -- --dry-run    # build and hash, write nothing
npm run package                 # dist/graffiticode-plugin-<version>.zip
```

The build is a pure function of one commit: it resolves `--ref` (default `origin/main`) to a
SHA, gates on that ref's own `validate`, and reads every shipped byte out of git rather than
off disk — so an uncommitted edit cannot ship. Output is byte-identical across machines,
timezones and locales, which is what makes the checklist below verifiable at all.

Checklist for the ZIP:
- [ ] Built from a **pushed** commit (the build refuses anything else) and `npm run validate`
      is green.
- [ ] `interface` text matches `openai-listing-copy.md`, and every capability it claims is one
      the current catalog actually serves.
- [ ] `version` matches what the portal draft carries (see the record below).
- [ ] **Record the artifact SHA-256 and the ref it was built from**, so the ZIP the portal
      holds is comparable to the ZIP the repo produces.

| Version | Ref | SHA-256 | Uploaded |
|---|---|---|---|
| 2.1.0 | `0d517e3` (2026-09-17) | `3276f51a3442842999e26a73098927351dc4e80ff5e4412647e1aa5474a3a5f9` | not yet |

Rebuild that ref to compare: `npm run package -- --ref 7e4945f --dry-run` prints the same
SHA-256 or the artifact is not what this table claims.

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
      starter prompts. Partly satisfied. On 2026-09-11 an L0173 chart was seen drawing in the
      **ChatGPT mobile app** — the first confirmed OpenAI-host render. The same item fell back
      to the content card in ChatGPT desktop; root-caused 2026-09-15 as a delivery race in the
      Skybridge watch loop (§10) and fixed. **On 2026-09-16 at 02:45 UTC a person watched an
      L0173 chart render quickly in Codex on the CURRENT build** — the `resources/read` line
      names `ae93cbff`, so this is the first confirmed render of the fixed widget in a real
      host, on the same Skybridge path ChatGPT uses. Not yet confirmed in ChatGPT itself, whose
      cloud side was still reading the 09-11 build ninety seconds earlier (§11). Since the
      reviewer tests both surfaces, this gate is not met until ChatGPT is seen on a current
      build.
      jsdom is not a substitute — it cannot render L0173 at all (ECharts needs a canvas it
      lacks). **Record the widget hash that client read** (§11) — a render proves nothing about
      the current build unless the `[widget] resources/read` line names it.
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
6. Upload the **plugin ZIP** (§2), built with `npm run package`.
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
   the same L0173 chart. **Root-caused 2026-09-15, fixed, and confirmed rendering 2026-09-16
   at 02:45 UTC** — a chart drew quickly in Codex on `ae93cbff`, the fixed build, verified by
   the `resources/read` line rather than by the render alone. ChatGPT itself has still not been
   seen on a current build.

   The cause was a delivery race, not a host capability. Skybridge carries a tool result on
   two globals — `toolOutput` (structuredContent) and `toolResponseMetadata` (`_meta`) — and
   for `render_item` the src/data a native mount needs lives ONLY in the metadata, because the
   structuredContent is compact by design. `SkybridgeHost.connect()` keyed its "is this new?"
   check on `JSON.stringify(r.structuredContent)` alone. A host that sets the output first
   therefore delivered a payload with no render data, the renderer correctly fell back to the
   card, and every later tick that DID carry the metadata was suppressed as a duplicate. The
   card was permanent, no mount was ever attempted, and no bundle fetch existed to explain it.
   Mobile simply won the race. The key now covers `meta`, pinned by
   `tests/widget-skybridge-late-meta.test.ts` (late metadata re-delivers; a stable payload
   still delivers once).

   **For whoever reads the 2026-09-11 commit messages:** `f5759be` says the bundle was
   "fetched with a 200 in both". The logs do not support that. Every Mac-Chrome
   `/widget/lang/*.mjs` fetch that day belongs to an `openai-mcp (Codex)` session — each one
   seconds after that session's own `resources/read` — and the only fetch from a plain
   `openai-mcp` session is the Android one that worked. The ABSENCE of a desktop fetch is what
   identifies the failure as "never attempted a mount" rather than "mounted and drew nothing".

   **What this does NOT rule out:** that the desktop host never populates
   `toolResponseMetadata` at all, in which case the symptom survives the fix. Logs cannot tell
   "late" from "never". If a desktop repro still shows the card, that is the answer — and the
   diagnostic to add next is a visible note for "a native language arrived with no render
   payload", which today falls back silently.
2. **A person has still not watched all three starter prompts render** on either OpenAI
   surface — one chart on mobile is the whole of the evidence. §5 gate.
3. **`list_languages(search: "invoice")` returns nothing**, as does any word the catalog's
   keywords miss. Starter prompt 1 routes correctly anyway (3/3 on the inlined catalog), but a
   reviewer who searches before creating gets an empty result. The keyword index lives in the
   console, not this repo.
4. ~~**L0169's `render_item` summary is empty**~~ — **fixed 2026-09-16.** The extractor
   understood only a finished diagram, whose content sits in each node's `text`; an assessment
   web has blank node text by design, with the answers in `assess.expected` and the options in
   `concepts`, so every string it read was `""` and it returned nothing. The summary now gives
   the topic, instructions, how many nodes are to be filled, and the tray — but not the
   node-to-answer mapping, which is the answer key.
5. The v3 copy gaps in `openai-listing-copy.md` (L0177/L0178 invisible; the `learnosity`
   indexing experiment).

---

## 11. Widget builds and client caching — the stale-widget trap

**Nothing about widget code can be concluded from what a client renders until you know which
build that client loaded.** Established 2026-09-15/16 over an evening of testing, at the cost
of two wrong diagnoses.

The widget resource URI is content-hashed (`widgetResourceUris()`), so every build gets its own
URI. That defends against a host caching the CONTENT under a stable URI. It does not defend
against a host caching **the URI itself** — and the URI is delivered in `tools/list`, which
OpenAI clients cache aggressively:

| Time (UTC) | Client | Widget URI it read |
|---|---|---|
| 00:22:45 | — | revision `00187-nx4` begins serving `ae93cbff` |
| 00:23–00:24 | `openai-mcp` (ChatGPT) | **no `tools/list`, no `resources/read`** — ran entirely from cache |
| 00:27:16 | `codex-mcp-client` | `2c1856e8` |
| 00:31:11 | diagnostic probe | `ae93cbff` ← still the only client that has ever read it |
| 00:42–00:44 | `openai-mcp` (ChatGPT) | no reads; two L0173 renders showed a link, one L0169 mounted |
| 00:50:13 | `codex-mcp-client` | fresh `tools/list` |
| 00:51:23 | `openai-mcp (Codex)` | `63bb0b17` — **70 seconds after that fresh list**, and a build already in use on 09-11 at 18:24 |

So a client can re-list tools and still read a URI we stopped advertising hours earlier. A
user-initiated reconnect did not force a re-scan; restarting the app produced sessions that
rendered correctly — on `63bb0b17`, a build that predates BOTH the 09-11 transport fix and the
09-15 late-metadata fix. **A render that works is not evidence the current code works.**

**There is a daily scan.** OpenAI reads `tools/list` and the widget resource every day at
**14:21 UTC**, on the minute (observed 09-11 through 09-15). It does take the current URI. But
four consecutive scans saw `2c1856e8` while interactive sessions kept reading `63bb0b17`, so
whatever the scan refreshes, it is not what a user's client mounts.

**The split, caught in one window.** On 2026-09-16, ninety seconds apart in the same Codex
session, two components of the same product loaded two different builds:

| Time (UTC) | Client | Build |
|---|---|---|
| 02:44:52 | `openai-mcp (Codex)` — OpenAI's cloud side | `63bb0b17` (2026-09-11) |
| 02:45:38 | `codex-mcp-client` — the local Codex client | `ae93cbff` (current) |

The local client is the one a restart refreshes; the cloud side keeps its own snapshot and does
not. That is why restarting an app can leave the rendered widget unchanged, and it is the
likeliest explanation of the 09-11 "desktop renders, mobile doesn't" split — two caches, not two
behaviours. **The chart that rendered at 02:45:56 was the first confirmed render of a current
build in any OpenAI host.**

**What this changes:**

1. **Always read the `[widget] resources/read` log line before drawing a conclusion.** It is
   the only place the loaded build is recorded. Two clients with the same name and version can
   be running different builds — which is sufficient, by itself, to produce a "desktop renders,
   mobile doesn't" split with no code difference anywhere. The 09-11 desktop/mobile finding was
   read as a code bug twice before this was understood.
2. **A widget change is not shipped when it deploys.** It is shipped when a host reads the new
   URI. Deploy widget changes well ahead of any review window and confirm with a log line.
3. **For the review itself this is good news**: the daily scan takes the current build, and a
   reviewer connecting fresh gets whatever `tools/list` says at that moment. The trap is one we
   set for ourselves in testing.
4. **Open:** nothing we control is known to force an interactive client to refresh — not a
   deploy, not a reconnect, not the daily scan.

To check what any client is loading:

```bash
gcloud logging read 'resource.labels.service_name="mcp-service" AND textPayload:"resources/read"' \
  --project graffiticode-app --freshness=2h --format="value(timestamp,textPayload)"
```

### Codex flips routes between launches

Same binary, minutes apart, on 2026-09-16:

- 00:49:21 — `codex-mcp-client v0.154.0-alpha.6.2`, `declares_ui_extension=false`, `extensions=[]` → **`openai`** route (Skybridge)
- 00:49:57 — `codex-mcp-client v0.154.0-alpha.6.2`, `declares_ui_extension=true`, `extensions=[io.modelcontextprotocol/ui, openai/elicitation, openai/form]` → **`mcp-apps`** route

Version 0.153.4 declared the extension consistently earlier the same evening. **Any rule keyed
on that declaration is non-deterministic per launch**, so both routes have to work for the same
client — which is the argument for the `RacingHost` transport (`365e406`) being the real fix and
the routing rule being close to cosmetic.
