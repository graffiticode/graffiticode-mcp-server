import assert from "node:assert/strict";
import test from "node:test";
import {
  contentToMarkdown,
  describeItem,
  mergeToolPayload,
  normalizeLang,
  unwrapData,
} from "../src/item-content.js";
import {
  buildReadySummary,
  buildGeneratingSummary,
  buildFailedSummary,
} from "../src/tools.js";

// A Learnosity-shaped payload, spelled the way the compiler emits it: questions
// under data.request, the answer key under the hyphenated `valid-response`.
const LEARNOSITY = {
  language: "L0176",
  data: {
    request: {
      questions: [
        {
          stimulus: "<p>Which stage turns vapor into droplets?</p>",
          options: [
            { value: "0", label: "Evaporation" },
            { value: "1", label: "Condensation" },
          ],
          "valid-response": { value: ["1"] },
        },
      ],
    },
  },
};

test("describeItem extracts questions and marks the correct option", () => {
  const c = describeItem("L0176", LEARNOSITY);
  assert.equal(c.kind, "questions");
  if (c.kind !== "questions") return;
  assert.equal(c.count, 1);
  // HTML tags are markup, not content — they must not survive into a chat message.
  assert.equal(c.shown[0].stimulus, "Which stage turns vapor into droplets?");
  assert.deepEqual(
    c.shown[0].options.map((o) => [o.label, o.correct]),
    [["Evaporation", false], ["Condensation", true]]
  );
});

test("the answer key survives into the Markdown", () => {
  const md = contentToMarkdown(describeItem("L0176", LEARNOSITY));
  assert.match(md, /\*\*1 question\*\*/);
  assert.match(md, /- ✓ Condensation/);
  // The wrong answer is listed, but unmarked.
  assert.match(md, /- Evaporation/);
});

test("camelCase validResponse is honoured too", () => {
  const c = describeItem("L0176", {
    language: "L0176",
    data: { request: { questions: [{ prompt: "Q", options: [{ value: "a", label: "A" }], validResponse: { value: ["a"] } }] } },
  });
  assert.equal(c.kind === "questions" && c.shown[0].options[0].correct, true);
});

test("more than eight questions reports the remainder rather than dropping it", () => {
  const questions = Array.from({ length: 11 }, (_, i) => ({ stimulus: `Q${i}`, options: [] }));
  const c = describeItem("L0176", { language: "L0176", data: { request: { questions } } });
  assert.equal(c.kind === "questions" && c.count, 11);
  assert.equal(c.kind === "questions" && c.shown.length, 8);
  assert.match(contentToMarkdown(c), /…and 3 more\./);
});

test("a spec language renders as prose, not JSON", () => {
  const c = describeItem("L0177", { language: "L0177", data: { print: "# Recipe\nStep one." } });
  assert.equal(c.kind, "prose");
  assert.equal(contentToMarkdown(c), "# Recipe\nStep one.");
});

test("anything else gets a fenced JSON preview", () => {
  const md = contentToMarkdown(describeItem("L0179", { language: "L0179", data: { sheets: [{ id: "s1" }] } }));
  assert.match(md, /^```json\n/);
  assert.match(md, /"sheets"/);
});

test("no data yields empty content, and empty renders as nothing", () => {
  const c = describeItem("L0179", { language: "L0179" });
  assert.equal(c.kind, "empty");
  assert.equal(contentToMarkdown(c), "");
});

test("unwrapData unwraps the { data, errors } envelope", () => {
  assert.deepEqual(unwrapData({ data: { a: 1 }, errors: [] }), { a: 1 });
  assert.deepEqual(unwrapData({ a: 1 }), { a: 1 });
});

test("normalizeLang accepts both spellings", () => {
  assert.equal(normalizeLang("0179"), "L0179");
  assert.equal(normalizeLang("L0179"), "L0179");
});

test("hydration overrides structuredContent when merging", () => {
  const merged = mergeToolPayload({
    structuredContent: { item_id: "x", status: "ready" },
    meta: { graffiticode: { data: { a: 1 } } },
  });
  assert.equal(merged.item_id, "x");
  assert.deepEqual(merged.data, { a: 1 });
});

// --- The summaries clients actually read ------------------------------------

test("the ready summary carries the content, not just a link", () => {
  const s = buildReadySummary("Water Cycle", "L0176", "https://app.example/form/x", undefined, LEARNOSITY);
  assert.match(s, /\*\*Water Cycle\*\* \(L0176\) is ready/);
  assert.match(s, /✓ Condensation/);
});

test("the ready summary still works without a payload", () => {
  const s = buildReadySummary("Budget", "L0179", "https://app.example/form/x");
  assert.match(s, /\*\*Budget\*\* \(L0179\) is ready/);
});

test("the console's 'unnamed' placeholder is never shown as a title", () => {
  for (const s of [
    buildReadySummary("unnamed", "L0179", "https://app.example/form/x"),
    buildGeneratingSummary("unnamed", "render_item", "abc"),
    buildFailedSummary("unnamed", "L0179", "boom"),
  ]) {
    assert.doesNotMatch(s, /unnamed/);
    assert.match(s, /Your item/);
  }
});

// The regression that motivated this file: these two states carried no `summary`,
// so formatToolResult fell back to JSON.stringify and answered the user with a
// pretty-printed blob.
test("generating and failed produce prose, and never look like JSON", () => {
  const gen = buildGeneratingSummary("Quiz", "render_item", "abc123");
  assert.match(gen, /still generating/);
  assert.match(gen, /render_item\("abc123"\)/);

  const failed = buildFailedSummary("Quiz", "L0176", "Generation timed out");
  assert.match(failed, /could not be generated — Generation timed out/);

  for (const s of [gen, failed]) assert.doesNotMatch(s, /^\s*[{[]/);
});
