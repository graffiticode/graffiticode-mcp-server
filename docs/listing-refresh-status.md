# ChatGPT listing refresh — where we are

**Pick-up-here document.** Written 2026-09-16 at the end of a long working session. It records
state and decisions, not procedure: the runbook is [`openai-submission.md`](./openai-submission.md)
(§10 tracks the rejection findings, §11 the widget-caching trap) and the canonical copy is
[`openai-listing-copy.md`](./openai-listing-copy.md). **Update this file whenever the state
changes**; a status doc that has gone stale is worse than none, as §11 records at length.

---

## Status at a glance

| | |
|---|---|
| Live in the directory | **v1.0.0**, approved 2026-08-14 |
| Last submission | **v2.0.0, REJECTED 2026-08-30** — "one or more test cases did not produce correct results" |
| The v2 draft | **still editable in the portal** (read back 2026-09-16). This is what resubmits unless changed |
| Resubmission | **not filed.** Blocked on one thing: nobody has run the 5+3 test cases in ChatGPT |
| Server | `mcp-service-00191-jcj` (2026-09-16 17:33 UTC). **`e2365df` is committed and NOT deployed** |
| Console | `console-00618-4gk` (2026-09-16), carries the catalog-search work |

---

## The critical path

1. **Deploy `e2365df`** (`npm run gcp:deploy`). It carries the multi-question quiz summary and
   the Learnosity ✓ answer key — the second of which starter prompt 3 promises in the live
   listing. **This moves the widget hash** (`src/item-content.ts` is bundled into the widget),
   so re-read the current hash afterwards before trusting any render. *Mine to run.*
2. **Refresh §6's 5+3 test cases** so they name the current languages and verified outcomes.
   They were written before L0180 and L0181 existed, and a reviewer follows them literally.
   *Mine to draft.*
3. **Run the 5+3 by hand in ChatGPT**, on a build whose hash you have checked. This is the
   whole ballgame: the rejection said test cases failed, and two of the five never reached the
   server at all. *Yours — no agent can do it.*
4. **Paste the copy decisions** into the draft (see below). *Yours.*
5. **Resubmit.**

Everything else — latency, routing, the widget race, the catalog search — is done and verified.

---

## Decisions owed

1. **Subtitle.** Draft holds `Assessments, diagrams and more` (30/30). Proposed:
   `Quizzes, spreadsheets, charts` (29/30) — the live one spends its characters on the two
   words nobody searches. Rationale in `openai-listing-copy.md`.
2. **Description.** Adopt the three-paragraph draft that adds L0177/L0178, or keep v2's
   two-paragraph text and leave both integration languages invisible.
3. **Starter prompt 1.** Its recorded output claimed `$#,##0.00` currency formatting, which was
   L0166's behaviour; L0179 emits raw numbers. Accept the plain invoice, or ask for formatting
   in the prompt and re-verify. **Do not resubmit with the stale expectation in the record.**
4. **L0159.** It is `hidden`, so `matching game` / `memory game` cannot be advertised or routed
   to. Unhide it and both words go into the copy and the catalog; leave it and they stay out.

---

## Verified, with dates

Nothing here should be re-derived. Everything else should be treated as unknown.

| What | When | Result |
|---|---|---|
| Starter prompt routing, 3 runs each | 2026-09-15 | L0179 / L0169 / L0176, 3/3 each; prompts 1–2 route with zero discovery calls |
| Starter prompt generation | 2026-09-15 | 13.0s / 9.7s / 7.4s, contents checked field by field |
| Full routing eval | 2026-09-15 | 14 cases × 3 runs + 10 catalog invariants, all green |
| Catalog search after the console deploy | 2026-09-16 | `invoice`→L0179, `flashcards`→L0181, `quiz`→L0180, `do my laundry`→(none) |
| Widget render on a NAMED build | 2026-09-16 02:45 / 02:49 UTC | L0173 chart and L0169 concept web drew in Codex on `ae93cbff` |
| ChatGPT served the current build | 2026-09-16 16:21 UTC | read the legacy URI, which maps to current — see below |
| Demo sequence end to end | 2026-09-16 | quiz 13.6s → add cloze ~20s → flashcards via `get_spec` ~25-30s |

**The rule that makes those dates meaningful:** a render proves nothing unless you know which
build the client loaded. Check before concluding anything:

```bash
gcloud logging read 'resource.labels.service_name="mcp-service" AND textPayload:"resources/read"' \
  --project graffiticode-app --freshness=2h --format="value(timestamp,textPayload)"
```

Current build as of this writing: **`25e0a64c`**. It moves on the next deploy.

## Not verified

- **No person has watched a widget render in ChatGPT itself.** Codex, yes. ChatGPT, never — on
  any build, including the ones it was demonstrably served.
- **The multi-question quiz shape in the widget.** A five-question quiz is
  `data.activity.items[]`, a different shape from the single item our mount test covers. That
  exact distinction was broken in the summary extractor until 2026-09-16. Dry-run before filming
  or demoing.
- **Which copy the LIVE v1.0.0 listing shows.** The 2026-09-16 read-back was the v2 draft.
  Whether any v2 copy reached the published listing through post-approval editing is unanswered.
- **L0180 and L0181 rendering in any OpenAI host.**

---

## What we learned that is not obvious

**Clients mount the widget build they cached, not the one we serve.** The resource URI is
content-hashed so new content cannot be served from a cache keyed on a stable URI — but the URI
itself arrives in `tools/list`, and these clients cache that. One read a build from five days
earlier seventy seconds after a fresh `tools/list`. Two diagnoses were wrong before this was
understood. Full account in §11.

**The legacy URI is a working escape hatch.** ChatGPT's runtime asks for
`ui://graffiticode/claude-form-widget.html`, from before content hashing existed, and
`src/widget/index.ts:52` maps it to the **current** widget. So ChatGPT gets today's build
despite an ancient cached id — which is why the caching trap is survivable at all. Do not remove
that shim.

**OpenAI scans the server daily at 14:21 UTC**, on the minute, reading `tools/list` and the
widget resource, and it does take the current URI. It is not what refreshes what a user's
client mounts.

**One product, two clients, two caches.** `codex-mcp-client` (local, refreshed on launch) and
`openai-mcp (Codex)` (OpenAI's cloud side, its own snapshot) loaded different builds ninety
seconds apart in the same session. That alone can produce a "renders on mobile, card on desktop"
split with no code difference — which is what the 2026-09-11 finding probably was.

**Codex flips its capability declaration between launches** of the same binary, so it lands on
the `mcp-apps` route or the `openai` route at random. Both must work; this is why the transport
is raced rather than guessed.

**Empty summaries hide behind widgets.** Three languages returned a title and a link and nothing
else — L0169, L0180 multi-question, and every Learnosity answer key — because a widget host
mounts the real component and never reads the summary. The only clients that can see the bug are
the ones we were not watching. Assume the next one is broken too until a payload is checked.

**Evals go stale silently.** Two routing cases asserted a catalog that no longer existed and
were only caught because unrelated work forced a full run.

---

## The 90-second screencast (for the listing)

Four shots, all dry-run against production on 2026-09-16.

1. **"Make a 5-question multiple-choice quiz on the water cycle."** (~14s) — it mounts, and
   **you answer a question on camera and it scores you.** That shot is the whole pitch.
2. **"Add a fill-in-the-blank question about condensation."** (~20s) — returns as question 6, a
   text-entry blank accepting "condensation". Refinement is just talking.
3. **"Turn that into a flashcard deck for studying."** (~25-30s) — `get_spec` carries the
   content across languages: 6 cards, each question mapped to its answer. L0181 renders
   natively as of 2026-09-16.
4. **"Open in Graffiticode"** — it persists and it is editable.

Leave out the Learnosity integration recipes (spec prose, bad on video) and anything unverified
on the host you record in. Three generations is ~60s of a 90s video, so trim in post but leave
the progress line visible for a beat — "11s, ~433 tokens written" reads as working rather than
hung. If a `render_item` errors, ask again; one timed out and succeeded on retry.

---

## Where things live

- **Runbook and reviewer materials:** `openai-submission.md` (§10 rejection findings, §11 caching)
- **Canonical copy, per version:** `openai-listing-copy.md` (read-back, proposals, verification)
- **Routing eval:** `npm run eval:routing`, or `-- --only starter` for the three storefront
  prompts. Re-run after touching `SERVER_INSTRUCTIONS`, tool descriptions, or the catalog.
- **Catalog search:** lives in the **console** repo (`src/lib/languages.ts`), not this one.
- **Scheduled reminder:** routine `trig_011UsNKpmrBBdVJr8eNBwz3j`. It fired 2026-09-16 14:45 UTC,
  confirmed no `src/` drift, and correctly refused to fake the ChatGPT test rather than invent a
  result. A one-shot; re-arm it with a new `run_once_at` if you want another.
