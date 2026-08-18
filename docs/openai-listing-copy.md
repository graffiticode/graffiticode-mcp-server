# OpenAI / ChatGPT listing copy — canonical source

The publisher portal is **not** the source of truth. Every public field of the ChatGPT
directory listing is recorded here, per version, so the live listing can be reproduced,
diffed, and reviewed without logging in.

Companion to `openai-submission.md` (the operational runbook). Required by Phase 2 of
`artcompiler/marketing/graffiticode-agent-capability-messaging-action-plan.md`.

**Rule:** change the portal and this file in the same sitting. A field that exists only in
the portal is a field nobody can review.

---

## v2 — submitted 2026-08-18

> ⚠️ **Fields below are AS PROPOSED, not yet read back from the portal.** They were drafted
> and tested on 2026-08-18 and submitted the same day. Confirm against the live listing and
> correct any drift, then delete this warning.

**Category:** `Productivity` *(was: Developer Tools)*

**Name:** `Graffiticode`

**Tagline** (41 chars):

```
Quizzes, spreadsheets, diagrams, and more
```

Shorter fallback if the field tightens (35): `Quizzes, sheets, diagrams, and more`

**Description:**

> Graffiticode is a platform of specialized agents, each purpose-built for one kind of task
> and each producing a real, editable artifact rather than text in a chat window.
>
> Today's agents create interactive quizzes and assessments, worksheets, flashcards,
> spreadsheets and budgets, charts, and concept diagrams — including Learnosity-compatible
> assessment items. Describe what you want in plain English; the matching agent validates
> your request against a formal task language and returns a structured result you can
> refine, re-render, and keep. New agents are added to the catalog over time.

**Starter prompts** (portal limit: **128 characters each**):

| # | Prompt | Chars | Language | Verified output |
|---|---|---|---|---|
| 1 | `Create an invoice with line items, quantity, unit price, a line total for each row, and a grand total.` | 102 | L0166 | per-row `=B2*C2`, `=SUM(D2:D4)` grand total, `$#,##0.00` formatting |
| 2 | `Create a concept web explaining how rain forms.` | 47 | L0169 | 5 assessed nodes + populated 6-concept drag tray |
| 3 | `Create a Learnosity water cycle assessment: one multiple-choice and one fill-in-the-blank, answers marked.` | 106 | L0176 | MCQ with correct option marked + `clozetext` with `{{response}}`, signed payload |

Every prompt above was executed against production before submission — see the
"Prompt verification" section.

### Why these changed from v1

Driven by `artcompiler/marketing/graffiticode-chatgpt-listing-audit.md`: the v1 listing
matched **0 of 8** realistic user searches and 1 of 1 brand-name searches. Category and
copy were the two levers; category affects browse, description text is what plausibly
feeds search.

- **Category** — Developer Tools is an engineer's aisle; the example prompts were always
  end-user content. Productivity was chosen over Education & Research deliberately:
  Graffiticode is a horizontal platform of micro-agents and today's education skew is an
  artifact of which languages shipped first, not an identity. Filing under education would
  have required re-filing the moment a finance or ops language lands.
- **Tagline** — "Verified task execution" names no output. In list view it is the entire
  pitch.
- **Description** — the phrase "helps developers expose their services" is a faithful
  rendering of the positioning in `graffiticode-description-evolution.md`, and correct for
  the audience it was written for. It is wrong for a consumer storefront. The
  capability-boundary story survives in "validates your request against a formal task
  language"; only the audience marker was removed. The developer-facing rendering belongs
  on the site and README.
- **Starter prompt 2** — the v1 photosynthesis prompt returned an inert diagram with every
  answer pre-filled and an empty drag-and-drop tray. See "L0169 prompt mode" below.
- **Starter prompt 1** — replaced the budget spreadsheet, which is the same job done less
  well; keeping both would have spent two of three slots on spreadsheets.

### Known gaps in v2 — candidates for v3

Phase 2 of the messaging action plan asks for **both job families** in the listing. v2
ships only one.

- **L0177 (Learnosity Author API) and L0178 (Data API) are invisible.** The copy is
  entirely about interactive artifacts and never mentions integration recipes. Two of the
  seven flagship capabilities have no listing presence — and they are the surface most
  relevant to a Learnosity partnership conversation.
- **Indexed vocabulary the action plan calls for and v2 omits:** `author api`, `data api`,
  `item bank`, `matching game`, `memory game`, `concept map`, `mind map`.
- **The action plan's preferred tagline** was
  `Flashcards, sheets, charts, and Learnosity work for your agent.` v2 diverges. Reconcile
  deliberately rather than by accident.
- **NGN bow-tie is not represented.** L0176 generates a valid bow-tie with correct
  index-based validation (verified 2026-08-18). It is the strongest single proof of
  Learnosity spec depth and is better used as a direct partner artifact than a storefront
  prompt — the clinical stimulus reads as alienating to a general browser, and the natural
  prompt is 166 chars, over the limit.

---

## v1 — approved 2026-08-14 (version 1.0.0)

Superseded by v2. Recorded for diffing.

**Category:** `Developer Tools`

**Tagline:** `Verified task execution`

**Description:**

> Graffiticode lets AI agents perform verified, task-specific operations instead of making
> unrestricted API calls. By using formal task languages to validate inputs, enforce
> capabilities, and produce structured artifacts, Graffiticode helps developers expose
> their services to AI agents with greater control, reliability, and predictable results.

**Starter prompts:**

1. `Create a polished bar chart showing monthly sales with sample data.` (67)
2. `Create a clear concept web explaining how photosynthesis works.` (63)
3. `Build a monthly budget spreadsheet with categories and a totals row` (67)

**Skills bundled:** `render`, `assessments`, `learnosity` — all three surface as chips on
the listing; only `learnosity` is independently searchable in the Skills directory, under
the legacy identity `questioncompiler-learnosity`.

---

## Prompt verification

Starter prompts are executed against production before submission. An untested prompt in a
storefront is a demo that fails in front of the person deciding whether to install.

v2 run, 2026-08-18 (authenticated account, so free-plan funnel metrics are unaffected):

| Prompt | Item | Result |
|---|---|---|
| Invoice (shipped) | `eawxo1XIb0dCxXLqgGDu` | formulas + currency formatting ✅ |
| Team expense report | `5ViMce0zc06Lc8eCFvff` | SUM + AVERAGE, **no currency formatting** — rejected |
| Rain concept web (shipped) | `J5x6SRClf2mIiERyqtUe` | interactive assessment, drag tray populated ✅ |
| Photosynthesis (v1) | `p736IAxqwAbjbcRiQUtR` | good content, **empty drag tray** — inert |
| States of matter | `iiHsSBF21RhD0LrZZs6M` | 3 bare nodes, no edges — trivial |
| Marketing channels | `ggpD826tGyjlfoChc3Hk` | 6 bare nodes, no edges — flat list |
| Plant needs/produces | `1Ph3HGpHgSHSgKGyNAnR` | 6 bare nodes, topic degraded to "Concept Web" |
| Learnosity, 148-char | `iSkS3Iqlr9MWlqOR0QEq` | MCQ + cloze ✅ but over the 128 limit |
| Learnosity, 106-char (shipped) | `RzTVYeFkMwZet6UDKQ20` | MCQ + cloze ✅ |
| NGN bow-tie | `t2Xb3Kq1YxOTnx4c48V7` | valid 3-column bow-tie, `[[1,2],[4],[7,10]]` ✅ |

One difference between the two Learnosity variants: the 148-char version set
`case_sensitive: false` on the cloze and the shipped 106-char version does not. Learnosity's
default for that field is unconfirmed.

### L0169 prompt mode

Non-obvious and worth preserving. L0169 has two output modes and the **prompt's framing**
selects between them:

- A **staged process** ("explaining how rain forms") produces a real assessment — node text
  emptied, `assess`/`expected` set per node, and the `concepts` drag tray populated.
- A **state description** ("explaining how photosynthesis works") produces a finished
  diagram with every answer already placed, `concepts: []` and `relations: []` — nothing to
  interact with.
- Asking for something "simple", or to "show" a set of things, produces a flat hub-and-spoke
  with no labeled edges at all — clean but uninformative.

The lever is the verb and whether the topic has stages, not the topic's difficulty.

---

## Re-audit protocol

Per Phase 2 step 6: re-run the discoverability audit **after the directory reports indexing
is complete**, not immediately after publish. Test both Plugins and Skills with at least:

`graffiticode`, `flashcards`, `spreadsheet`, `worksheet`, `concept map`, `chart`,
`assessment`, `learnosity`, `author api`, `data api`

**The `learnosity` query is the load-bearing one.** It returned a hard empty in Plugins on
2026-08-17 while the listing carried a skill of that name — zero competition, unambiguous
read. v2 puts "Learnosity" in the description and a starter prompt. If it starts matching,
description text feeds the index and copy is the lever for everything else. If it still
returns empty, the index reads only name and tagline, and the real constraint is the
product name — a materially more expensive conversation, worth reaching early.

Record results in `artcompiler/marketing/graffiticode-chatgpt-listing-audit.md`.
