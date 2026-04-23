---
name: questioncompiler-learnosity
description: Author Learnosity-compatible assessment items — MCQ, short text, cloze, formula, classification, order list, choice matrix, and other Learnosity question types — for embedding in a Learnosity-integrated LMS or publishing to a Learnosity Item Bank. Use whenever the user mentions Learnosity by name or describes authoring items for a Learnosity-based platform. For generic assessment authoring across flashcards, spreadsheets, concept webs, and other question types, use the `questioncompiler` skill instead.
---

# QuestionCompiler — Learnosity

Author Learnosity-compatible items via Graffiticode. This skill is the narrow, Learnosity-focused sibling of `questioncompiler`.

You don't need to know Learnosity's internal taxonomy (question types, scoring models, item references, activity wiring). The Graffiticode backend for the Learnosity language encodes all of that — your job is to pass a clear natural-language description and let the backend generate the compatible output.

## Prerequisite

The Graffiticode MCP connector must be installed and connected. If `list_languages` is unavailable, tell the user to connect it before proceeding.

## Workflow

**1. Discover the Learnosity brand set.**

Call `list_languages(domain: "learnosity")`. Today this returns a single language; the brand may grow (activity assemblers, item-bank sync tools) — the skill stays correct automatically.

**2. Read the language info.**

Call `get_language_info(language)` on the returned language. The response's `authoring_guide`, `supported_item_types`, and `example_prompts` are the authoritative source of what you can ask for. For deeper reference, read the `user_guide_resource` URI via `ReadResource`.

**3. Create the item.**

Call `create_item(language, description)` with a natural-language description. Write it the way you'd brief a content author — no Learnosity JSON, no Graffiticode DSL, no widget-type slugs. A good description is specific about:

- **Subject and scope** — topic, grade band, cognitive level (DOK, Bloom), difficulty
- **Quantity and structure** — how many items, how they're grouped, any activity structure
- **Question shape** — "a multiple-choice item with four options and one correct answer," "a short-text item with two acceptable answers," "a cloze item with three blanks"
- **Scoring intent** — exact match vs partial credit, per-blank scoring, rubric expectations
- **Metadata / taxonomy** — standards alignment, tags, difficulty labels if the user mentions them
- **Theme / accessibility** — any specific visual or a11y requirements

Bad: "Make a Learnosity MCQ about fractions."
Good: "Author a Learnosity multiple-choice item on adding fractions with unlike denominators for Grade 5. Four options, one correct answer, three distractors that reflect common errors (not finding a common denominator, adding numerators and denominators separately, forgetting to simplify). Exact-match scoring, one point. Tag the item with standard CCSS.MATH.CONTENT.5.NF.A.1."

**4. Iterate with `update_item`.**

`update_item(item_id, modification)` preserves conversation history. Incremental Learnosity-specific edits compose naturally: "add a second distractor matching the common error of …," "switch to partial-match scoring," "change the stimulus image," "add a hint," "tag with an additional standard."

**Do not call `get_item` before `update_item` for edits or saves.** `update_item` already reads the current state internally; an explicit `get_item` first is redundant and slower. Only call `get_item` when the user explicitly asks to inspect the item's current content or when you need to cite the item ID back to them.

## Side-effectful operations (saving to the item bank)

Saving to the Learnosity item bank is done via `update_item` with a natural-language instruction — no dedicated save tool exists and none is needed:

```
update_item(item_id, "save this item to the Learnosity item bank")
```

The language backend interprets the save intent and writes to Learnosity's Item Bank. Confirm the save by inspecting the `data.itemBank` field in the `update_item` response:

- **Success:** `data.itemBank = { saved: true, references: ["graffiticode-…"] | ["artcompiler-…"], savedAt: "2026-…" }`. Echo the reference(s) back to the user so they can locate the item in Learnosity's Author Site (e.g., "Saved to the Learnosity item bank with reference `graffiticode-abc123`.").
- **Failure:** the `update_item` call returns `errors` (the language backend's `dataApi` throws on non-2xx from Learnosity, which surfaces as a generation error). Relay the error message; do not assume the save succeeded.
- **No `itemBank` field present:** the user's instruction was interpreted as a content edit rather than a save. If they clearly asked to save, re-issue with a more explicit instruction ("save this item to the Learnosity item bank as a draft") and check `data.itemBank` again.

**Do not invent out-of-system save paths.** If the save feedback is ambiguous, ask the user to verify in the Learnosity Author Site rather than suggesting alternatives like "post directly to the Learnosity Items API with consumer key/secret," "use computer use to navigate the Author UI," or "import JSON manually." Those are outside this skill's scope and usually wrong — the save has almost certainly happened if `update_item` returned without errors.

## Output

Items render as interactive widgets inline in claude.ai. Confirm what was created or saved in a sentence (including the item-bank reference on save); don't dump DSL or Learnosity JSON — the widget displays the rendered item.

## Guardrails

- **Never hand-write Learnosity JSON or Graffiticode DSL.** The backend produces both from your natural-language description.
- **Never hardcode a language ID in your reasoning.** Always call `list_languages(domain: "learnosity")` at session start — the brand may add members over time.
- **Stay in the Learnosity lane.** If the user asks for something outside Learnosity (flashcards, spreadsheets, concept webs), suggest the broader `questioncompiler` skill rather than forcing a Learnosity fit.
- **Iterate, don't recreate.** On follow-up edits, call `update_item` on the existing `item_id`; fresh creates lose conversation history.
- **Don't improvise out-of-band save paths.** Saves go through `update_item`; ambiguous results get verified by the user in the Learnosity UI, not by inventing API-direct or computer-use workarounds.
