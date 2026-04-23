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

## Output

Items render as interactive widgets inline in claude.ai. Confirm what was created in a sentence; don't dump DSL or Learnosity JSON — the widget displays the rendered item.

## Guardrails

- **Never hand-write Learnosity JSON or Graffiticode DSL.** The backend produces both from your natural-language description.
- **Never hardcode a language ID in your reasoning.** Always call `list_languages(domain: "learnosity")` at session start — the brand may add members over time.
- **Stay in the Learnosity lane.** If the user asks for something outside Learnosity (flashcards, spreadsheets, concept webs), suggest the broader `questioncompiler` skill rather than forcing a Learnosity fit.
- **Iterate, don't recreate.** On follow-up edits, call `update_item` on the existing `item_id`; fresh creates lose conversation history.
