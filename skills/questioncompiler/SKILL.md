---
name: questioncompiler
description: Author interactive assessment items across the QuestionCompiler language family in Graffiticode — multiple-choice quizzes, flashcards, spreadsheet problems, area-model math, magic squares, map-based questions, and more. Use whenever the user wants to build a quiz, test, homework problem, study deck, or rubric-scored practice item across mixed question types. For requests that specifically target Learnosity (by name, or by referring to Learnosity's Item Bank, Items API, or LMS integration), prefer the `questioncompiler-learnosity` skill instead — it is the narrower, Learnosity-focused sibling.
---

# QuestionCompiler

QuestionCompiler is the assessment authoring surface of Graffiticode. Each assessment type is backed by a different Graffiticode language, and the full set is discovered at runtime — the catalog is dynamic. Your job is to route the user's request to the right language and produce a rendered item, not to write code yourself.

## Prerequisite

The Graffiticode MCP connector must be installed and connected. If `list_languages` is unavailable, tell the user to connect it before proceeding.

## Workflow

Every authoring request follows the same four steps. Do not skip steps 1–2; the catalog changes over time and hardcoding language IDs is wrong.

**1. Discover the QuestionCompiler language set.**

Call `list_languages(domain: "questioncompiler")`. This returns the current brand members with their `id`, `name`, `description`, and `domains`. Read the descriptions — this is the source of truth.

**2. Pick the best match by shape of request.**

Match the user's intent against the returned `description`s. If more than one language could fit, call `get_language_info(language)` on the top candidate to see `supported_item_types` and `example_prompts` before deciding. For deeper reference, read the `user_guide_resource` URI via `ReadResource`.

Rough shape-to-language mapping (verify against actual `description`s; do not rely on memorized IDs):

- **Multiple-choice, short-text, cloze, ordering, classification, choice-matrix** → the Learnosity-style assessment language.
- **Spreadsheet / tabular / formula-based problems (SUM, AVERAGE, IF, parameterized values)** → the spreadsheet language.
- **Flashcards, vocabulary pairs, match games, memory games** → the flashcard language.
- **Area-model multiplication with visual grids** → the area-model language.
- **Magic-square puzzles with grid number placement** → the magic-square language.
- **Interactive map / location-based questions** → the map-question language.

If nothing fits, say so and suggest `list_languages()` (no domain) to check the wider catalog — but do not force a mismatch.

**3. Create the item.**

Call `create_item(language, description)` with a natural-language description. The `description` is a prompt to a language-specific AI, not Graffiticode source — write it as you would explain the item to a colleague.

A good description is specific about:
- **Subject and scope** — topic, grade band, difficulty
- **Quantity and structure** — number of items, layout, sections
- **Assessment rules** — scoring, rubric, answer key expectations, hints
- **Theme / styling** — color, tone, any accessibility needs

Bad: "Make a quiz about fractions."
Good: "Create a 5-item multiple-choice quiz on adding fractions with unlike denominators. Grade 5 level. Each item has four choices with one correct answer and three plausible distractors that reflect common computational errors. Include an answer key and a one-sentence explanation per item."

**4. Iterate with `update_item`.**

`update_item(item_id, modification)` preserves conversation history, so incremental edits compose naturally: "make the distractors harder," "add a hint on question 3," "switch to a dark theme," "change the topic from fractions to decimals." Prefer iteration over recreation — history is lost on a fresh create.

## Output

Items render as interactive widgets inline in claude.ai. The tool response carries the widget metadata automatically. **The widget is the rendering. Your reply is a one-line summary, nothing more.**

Prefer the response's own summary fields for that one-sentence confirmation:

- **On first creation** (`create_item`): echo `description` ("what the code does") — e.g., *"Made a 5-item MCQ on photosynthesis with four distractors each."*
- **On edits** (`update_item`): echo `change_summary` ("what changed this turn") — e.g., *"Switched to dark theme and hardened the distractors on Q3."*

Don't re-parse `data` to describe what changed; the backend already wrote the summary for you. If a field is `null` (rare — typically only when the code generator failed), fall back to a brief summary drawn from the user's own request.

**Do not preview or simulate the item in chat.** No sample layouts, no mock multiple-choice blocks, no ASCII/Markdown renderings of the stem and options, no printed answer keys, no "here's what it looks like" sections. The widget renders the item — your one-liner is in addition to, not a substitute for, the widget. If the user asks "what does it look like?" or "show me the questions," point them at the widget; do not reproduce the content in prose or formatted text.

## Guardrails

- **Never write Graffiticode DSL directly.** The backend generates code from natural-language descriptions. If you catch yourself composing `L0158` code, stop and use `create_item`/`update_item` instead.
- **Never hardcode language IDs in your reasoning.** Call `list_languages(domain: "questioncompiler")` every session; memorized IDs go stale.
- **Do not invent languages.** If no returned language matches, say so — don't guess an ID.
- **Prefer brand-scoped discovery.** When the user is clearly in an assessment context, scope `list_languages` by `domain: "questioncompiler"` rather than searching the whole catalog — it's faster and reduces wrong-language picks.
- **Defer to `questioncompiler-learnosity` when appropriate.** If the user names Learnosity or describes authoring for a Learnosity-integrated LMS / Item Bank / Items API, the `questioncompiler-learnosity` skill (if installed) is the better fit — it is tighter and scoped to the `learnosity` domain. This skill will still handle the request in a pinch, but the dedicated skill is preferred.
- **Respect the conversation.** On follow-up edits, call `update_item` on the existing `item_id`; don't start over unless the user explicitly asks for a new item.
