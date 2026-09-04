import assert from "node:assert/strict";
import test from "node:test";
import {
  contentToMarkdown,
  describeItem,
  isTerminalStatus,
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

test("a sheet with no cells falls back to preview, which chat suppresses", () => {
  // sheets[] present but no `cells` — sheetToTable declines, so this lands on the
  // widget-only preview shape and contributes nothing to the chat text.
  const c = describeItem("L0179", { language: "L0179", data: { sheets: [{ id: "s1" }] } });
  assert.equal(c.kind, "preview");
  assert.equal(contentToMarkdown(c), "");
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

// --- Spreadsheets: a table, never a dump ------------------------------------

const SHEET = {
  language: "L0179",
  data: {
    sheets: [
      {
        id: "s1",
        name: "Water Cycle Stages",
        columns: { A: { width: 160 }, B: { width: 420 } },
        cells: {
          A1: { text: "Stage", "font-weight": "bold" },
          B1: { text: "Short Description", "font-weight": "bold" },
          A2: { text: "Evaporation" },
          B2: { text: "Liquid water warms and changes into water vapor." },
          A3: { text: "Condensation" },
          B3: { text: "Water vapor cools into droplets." },
        },
      },
      { id: "s2", name: "Notes", cells: { A1: { text: "x" } } },
    ],
  },
};

test("a spreadsheet becomes a table, keyed off shape not language id", () => {
  const c = describeItem("L0179", SHEET);
  assert.equal(c.kind, "table");
  if (c.kind !== "table") return;
  assert.deepEqual(c.headers, ["Stage", "Short Description"]);
  assert.equal(c.rows.length, 2);
  assert.deepEqual(c.rows[0], ["Evaporation", "Liquid water warms and changes into water vapor."]);
  assert.equal(c.totalSheets, 2);
  // Same compiled form, so the deprecated predecessor reads identically.
  assert.equal(describeItem("L0166", SHEET).kind, "table");
});

test("the table renders as Markdown with the other sheet noted", () => {
  const md = contentToMarkdown(describeItem("L0179", SHEET));
  assert.match(md, /\| Stage \| Short Description \|/);
  assert.match(md, /\| --- \| --- \|/);
  assert.match(md, /\| Evaporation \|/);
  assert.match(md, /…and 1 more sheet\./);
  assert.doesNotMatch(md, /font-weight/);
  // Two sheets, so naming this one is informative.
  assert.match(md, /\*\*Water Cycle Stages\*\*/);
});

test("cells are ordered by column and row, not by object key order", () => {
  const c = describeItem("L0179", {
    language: "L0179",
    data: { sheets: [{ cells: { B2: { text: "b2" }, A1: { text: "h1" }, A2: { text: "a2" }, B1: { text: "h2" } } }] },
  });
  assert.equal(c.kind === "table" && c.headers.join(","), "h1,h2");
  assert.equal(c.kind === "table" && c.rows[0].join(","), "a2,b2");
});

test("a pipe in a cell cannot break out of the table", () => {
  const md = contentToMarkdown(
    describeItem("L0179", { language: "L0179", data: { sheets: [{ cells: { A1: { text: "a|b" }, A2: { text: "c|d" } } }] } })
  );
  assert.match(md, /a\\\|b/);
  assert.match(md, /c\\\|d/);
});

// The whole point of the exercise: chat never receives machine output.
test("an unrecognised shape yields NO chat content, and never JSON", () => {
  const c = describeItem("L0170", { language: "L0170", data: { some: { nested: ["thing"] } } });
  assert.equal(c.kind, "preview"); // the widget may still show it
  assert.equal(contentToMarkdown(c), ""); // chat gets nothing
});

test("no describeItem output ever puts a JSON fence in chat", () => {
  const payloads = [
    { language: "L0179", data: { sheets: [{ cells: { A1: { text: "x" } } }] } },
    { language: "L0170", data: { anything: 1 } },
    { language: "L0176", data: { request: { questions: [{ stimulus: "q", options: [] }] } } },
    { language: "L0177", data: { print: "text" } },
    { language: "L0173", data: { chart: { series: [1, 2] } } },
  ];
  for (const p of payloads) {
    const md = contentToMarkdown(describeItem(normalizeLang(p.language), p));
    assert.doesNotMatch(md, /```json/);
    assert.doesNotMatch(md, /"font-weight"|\{\s*\n\s*"/);
  }
});

test("a single-sheet workbook does not repeat its name as a heading", () => {
  const md = contentToMarkdown(
    describeItem("L0179", { language: "L0179", data: { sheets: [{ name: "Budget", cells: { A1: { text: "H" }, A2: { text: "v" } } }] } })
  );
  assert.doesNotMatch(md, /\*\*Budget\*\*/);
  assert.match(md, /\| H \|/);
});

// --- Charts and concept webs, from real compiled output ---------------------

// Captured from item DUjFu0StLUJPRpT1T8b9 (L0173): ECharts option format.
const CHART = {
  language: "L0173",
  data: {
    data: {
      type: "chart",
      option: {
        title: { text: "Monthly Sales" },
        xAxis: { type: "category", data: ["January", "February", "March", "April"] },
        yAxis: { type: "value" },
        series: [{ type: "bar", data: [42000, 38000, 51000, 47000] }],
      },
    },
    errors: [],
  },
};

// Captured from item Wy4dOYQqcXMY35Gh4toK (L0169).
const WEB = {
  language: "L0169",
  data: {
    data: {
      conceptWeb: {
        topic: "Water Cycle",
        instructions: "Follow the arrows to explore each stage.",
        anchor: { text: "Water Cycle", value: "Water Cycle" },
        connections: [
          { text: "Evaporation", value: "Evaporation" },
          { text: "Condensation", value: "Condensation" },
        ],
        edges: [
          { type: "dashed", to: "*", from: "Water Cycle" },
          { type: "solid-arrow", from: "Evaporation", to: "Condensation", text: "Liquid water warms into vapor." },
        ],
      },
    },
    errors: [],
  },
};

test("a chart becomes the numbers it draws", () => {
  const c = describeItem("L0173", CHART);
  assert.equal(c.kind, "chart");
  if (c.kind !== "chart") return;
  assert.equal(c.title, "Monthly Sales");
  assert.equal(c.chartType, "bar");
  assert.deepEqual(c.categories, ["January", "February", "March", "April"]);
  assert.deepEqual(c.series[0].values, ["42000", "38000", "51000", "47000"]);

  const md = contentToMarkdown(c);
  assert.match(md, /\*\*Monthly Sales\*\* — bar chart/);
  assert.match(md, /\| January \| 42000 \|/);
});

test("a concept web keeps its edge labels, and drops the layout edge", () => {
  const c = describeItem("L0169", WEB);
  assert.equal(c.kind, "conceptweb");
  if (c.kind !== "conceptweb") return;
  assert.equal(c.topic, "Water Cycle");
  assert.deepEqual(c.concepts, ["Evaporation", "Condensation"]);
  // The `to: "*"` radial fan-out is layout, not content.
  assert.equal(c.links.length, 1);
  assert.deepEqual(c.links[0], {
    from: "Evaporation",
    to: "Condensation",
    label: "Liquid water warms into vapor.",
  });

  const md = contentToMarkdown(c);
  assert.match(md, /\*\*Water Cycle\*\* — concept web/);
  assert.match(md, /- Evaporation → Condensation — Liquid water warms into vapor\./);
});

test("charts and concept webs reach chat, and still never as JSON", () => {
  for (const p of [CHART, WEB]) {
    const md = contentToMarkdown(describeItem(normalizeLang(p.language), p));
    assert.notEqual(md, "");
    assert.doesNotMatch(md, /```json|"type":/);
  }
});

// Captured VERBATIM from item f4eWUhBhHKnONtgERcZ0 (L0179) against production.
// The first version of the table branch guessed `data.sheets[].cells` from a log
// excerpt and shipped: the real single-table shape puts cells under
// `data.interaction.cells`, so it never fired and spreadsheets went out empty.
// This fixture is why the extraction now probes and verifies rather than assumes.
const REAL_L0179 = {
  language: "L0179",
  data: {
    data: {
      title: "",
      instructions: "",
      validation: { points: 0, regions: { "*": { primaryColumn: null, order: "expected", rows: [] } } },
      interaction: {
        type: "table",
        cells: {
          A1: { text: "Category", "font-weight": "bold" },
          B1: { text: "Amount", "font-weight": "bold" },
          A2: { text: "Rent" },
          B2: { text: "2000" },
          A3: { text: "Food" },
          B3: { text: "600" },
        },
      },
    },
    errors: [],
  },
};

test("the REAL L0179 shape renders as a table", () => {
  const c = describeItem("L0179", REAL_L0179);
  assert.equal(c.kind, "table");
  if (c.kind !== "table") return;
  assert.deepEqual(c.headers, ["Category", "Amount"]);
  assert.deepEqual(c.rows, [["Rent", "2000"], ["Food", "600"]]);

  const md = contentToMarkdown(c);
  assert.match(md, /\| Category \| Amount \|/);
  assert.match(md, /\| Rent \| 2000 \|/);
  assert.doesNotMatch(md, /font-weight/);
});

test("a container that holds no cell addresses is not mistaken for a sheet", () => {
  // `interaction` present but keyed by something else entirely — must fall
  // through rather than produce a table of nonsense.
  const c = describeItem("L0179", {
    language: "L0179",
    data: { interaction: { type: "table", cells: { foo: { text: "x" } } } },
  });
  assert.notEqual(c.kind, "table");
});

// --- The latch that made a slow item unrecoverable --------------------------

test("only 'generating' is non-terminal", () => {
  assert.equal(isTerminalStatus("generating"), false);
  for (const s of ["ready", "failed", "error", undefined]) {
    assert.equal(isTerminalStatus(s), true, `${s} should be terminal`);
  }
});

test("render_item's poll-deadline shape is exactly the non-terminal case", () => {
  // This is the payload handleItemResult returns when its 45s poll expires. The
  // widget latched on it and ignored the ready result that followed.
  const deadline = { item_id: "x", status: "generating", language: "L0179", name: "n" };
  assert.equal(isTerminalStatus(deadline.status), false);
  const ready = { item_id: "x", status: "ready", language: "L0179", name: "n" };
  assert.equal(isTerminalStatus(ready.status), true);
});


/**
 * L0180 fell through every branch to `preview`, and `preview` is deliberately empty
 * in chat — so the most-used assessment language summarised as a title and a link,
 * and a model relaying that could only say it had made something. Both fixtures are
 * real compiled payloads.
 */
test("L0180 choice items summarise as questions with the answer key marked", () => {
  const content = describeItem("L0180", {
    data: {
      data: {
        interaction: {
          type: "choice",
          prompt: "Which gas do plants absorb from the air during photosynthesis?",
          maxChoices: 1,
          options: [
            { id: "A", text: "Oxygen" },
            { id: "B", text: "Carbon dioxide" },
            { id: "C", text: "Nitrogen" },
          ],
        },
        validation: {
          responseProcessing: "map_response",
          points: 1,
          mapping: { B: { correct: true, points: 1 } },
        },
      },
      errors: [],
    },
  });

  assert.equal(content.kind, "questions");
  const md = contentToMarkdown(content);
  assert.match(md, /Which gas do plants absorb/);
  assert.match(md, /✓ Carbon dioxide/);
  // Only the key is marked — a summary that ticks everything is worse than none.
  assert.doesNotMatch(md, /✓ Oxygen/);
  assert.doesNotMatch(md, /✓ Nitrogen/);
});

test("L0180 reads a match_correct key, not just a mapping", () => {
  // The two response-processing templates are alternatives and never both present;
  // reading only `mapping` would mark every option in this item wrong.
  const content = describeItem("L0180", {
    data: {
      interaction: {
        type: "choice",
        prompt: "Select both amphibians.",
        maxChoices: 2,
        options: [
          { id: "A", text: "Frog" },
          { id: "B", text: "Lizard" },
          { id: "C", text: "Salamander" },
        ],
      },
      validation: { responseProcessing: "match_correct", points: 1, correctResponse: ["A", "C"] },
    },
  });

  const md = contentToMarkdown(content);
  assert.match(md, /✓ Frog/);
  assert.match(md, /✓ Salamander/);
  assert.doesNotMatch(md, /✓ Lizard/);
});

test("L0180 multi-part items count and key each part", () => {
  const content = describeItem("L0180", {
    data: {
      interaction: {
        type: "item",
        stimulus: { title: "A short passage" },
        parts: [
          { id: "p1", type: "choice", prompt: "What is the claim?", options: [{ id: "A", text: "Frogs breathe through skin" }] },
          { id: "p2", type: "choice", prompt: "Which line supports it?", options: [{ id: "X", text: "Line 4" }, { id: "Y", text: "Line 9" }] },
        ],
      },
      validation: {
        points: 1,
        scoring: "conjunctive",
        parts: {
          p1: { points: 1, mapping: { A: { correct: true, points: 1 } } },
          p2: { points: 1, correctResponse: ["Y"] },
        },
      },
    },
  });

  assert.equal(content.kind, "questions");
  assert.equal((content as { count: number }).count, 2);
  const md = contentToMarkdown(content);
  assert.match(md, /2 questions/);
  assert.match(md, /✓ Frogs breathe through skin/);
  assert.match(md, /✓ Line 9/);
  assert.doesNotMatch(md, /✓ Line 4/);
});
