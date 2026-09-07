import assert from "node:assert/strict";
import test from "node:test";
import { activityOf, answerSurveyTool, openSurveyTool, tools } from "../src/tools.js";
import { describeItem } from "../src/item-content.js";

type ToolRecord = Record<string, unknown> & { name: string };

const byName = (n: string) => (tools as unknown as ToolRecord[]).find((t) => t.name === n);

test("both survey tools are registered", () => {
  assert.ok(byName("open_survey"), "open_survey is not in the tools array");
  assert.ok(byName("answer_survey"), "answer_survey is not in the tools array");
});

// The tool list is also duplicated in MCP_DISCOVERY, ABOUT_HTML and README.md. None of those
// can be asserted here: server.ts calls httpServer.listen() at module top level, so importing
// it from a test would start a server. Keeping them in sync stays a manual step, as CLAUDE.md
// says — this file only holds the registry itself.

test("participation is annotated as writing to a shared world", () => {
  // A participation enters a pool other people can see, so neither tool is read-only, and
  // both change publicly visible state. Neither destroys anything.
  for (const t of [openSurveyTool, answerSurveyTool]) {
    assert.equal(t.annotations.readOnlyHint, false, `${t.name} claims to be read-only`);
    assert.equal(t.annotations.openWorldHint, true, `${t.name} does not declare open-world`);
    assert.equal(t.annotations.destructiveHint, false);
  }
});

test("answer_survey requires the participation token", () => {
  // Without it every call starts a new run: MCP sessions do not persist between tool calls.
  assert.ok(answerSurveyTool.inputSchema.required.includes("participation_token"));
  assert.ok(!openSurveyTool.inputSchema.required.includes("participation_token"));
});

test("both declare the same output schema, so an agent parses one shape", () => {
  assert.deepEqual(openSurveyTool.outputSchema, answerSurveyTool.outputSchema);
  assert.equal(openSurveyTool.outputSchema.additionalProperties, false);
});

test("answer_survey's description names the shape for every capturing item", () => {
  // The agent picks the answer shape from this text plus answer_shape at runtime.
  for (const shape of ["selected", "ranked", "contribution"]) {
    assert.match(answerSurveyTool.description, new RegExp(shape));
  }
});

test("describeItem summarizes a survey rather than dumping JSON", () => {
  const data = {
    activity: {
      title: "You Can Choose",
      participants: ["human", "agent"],
      navigation: "linear",
      submission: "individual",
      items: [
        { id: 0, type: "select", prompt: "Which matter most?", sample: 10, maxChoices: 5 },
        { id: 1, type: "rank" },
        { id: 2, type: "results" },
      ],
    },
  };
  const out = describeItem("L0182", { data });
  assert.equal(out.kind, "prose");
  const text = (out as { text: string }).text;
  assert.match(text, /You Can Choose/);
  assert.match(text, /select → rank → results/);
  assert.match(text, /10 ideas from the pool and picks up to 5/);
  assert.match(text, /human and agent/);
});

test("describeItem leaves a non-survey item to the other branches", () => {
  const out = describeItem("L0182", { data: { activity: { items: [] } } });
  assert.notEqual(out.kind, "prose");
});

// The shape below is what `data(id)` actually returns for a real L0182 item — the compile
// envelope, not the compiled value. Reading `.activity` off it directly is undefined, which
// rejected every survey ever authored with "is not a survey ... this item is L0182". If this
// test is ever "simplified" by dropping the envelope, it stops testing the bug.
test("activityOf reads through the { data, errors } compile envelope", () => {
  const activity = {
    title: "You Can Choose",
    participants: ["human", "agent"],
    navigation: "linear",
    submission: "individual",
    items: [
      { id: 0, type: "select", prompt: "What should we focus on next?", sample: 10 },
      { id: 1, type: "rank" },
    ],
  };
  assert.deepEqual(activityOf({ data: { activity }, errors: [] }), activity);
  // A language that stores the compiled value bare must keep working too.
  assert.deepEqual(activityOf({ activity }), activity);
});

test("activityOf returns null for data that carries no activity", () => {
  assert.equal(activityOf({ data: { interaction: {} }, errors: [] }), null);
  assert.equal(activityOf({ data: null, errors: [{ message: "boom" }] }), null);
  assert.equal(activityOf(undefined), null);
  // An `activity` that is not a list of items is not one this player can take.
  assert.equal(activityOf({ data: { activity: { items: "nope" } } }), null);
});
