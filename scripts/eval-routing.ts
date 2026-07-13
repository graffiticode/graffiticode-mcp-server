// Routing eval: does an agent pick the RIGHT language for a prompt?
//
//   ANTHROPIC_API_KEY=<key> GRAFFITICODE_API_KEY=<key> npx tsx scripts/eval-routing.ts
//   ANTHROPIC_API_KEY=… GRAFFITICODE_API_KEY=… npx tsx scripts/eval-routing.ts --catalog-only
//
// eval-cross-language.ts calls the API directly, so it can't catch a routing bug — routing
// happens in the model's head. This eval puts a model in the loop with the REAL agent-facing
// surface (SERVER_INSTRUCTIONS + the live list_languages/get_language_info tool schemas and
// handlers from src/tools.ts, plus the assessments + learnosity SKILL.md bodies), gives it a
// prompt, and asserts which `language` it passes to create_item. create_item is stubbed — nothing
// is generated.
//
// The regression this exists to lock down: prompts that merely mention an assessment ("a
// 5-question quiz on the water cycle") were routing to the Learnosity languages (L0158/L0176),
// which are vendor-specific and should be chosen ONLY when the user names Learnosity.
//
// Routing is stochastic, so each case runs N times; a 1-of-N regression is still a regression.

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SERVER_INSTRUCTIONS,
  listLanguagesTool,
  getLanguageInfoTool,
  handleListLanguages,
  handleGetLanguageInfo,
  type ToolContext,
} from "../src/tools.js";
import type { AuthContext } from "../src/api.js";

const MODEL = "claude-opus-4-8";
const RUNS_PER_CASE = Number(process.env.EVAL_RUNS ?? 3);
const SKILLS_REPO = process.env.GRAFFITICODE_SKILLS_PATH ?? "../graffiticode-skills";

const catalogOnly = process.argv.includes("--catalog-only");

const gcKey = process.env.GRAFFITICODE_API_KEY;
if (!gcKey) {
  console.error("Set GRAFFITICODE_API_KEY to run this eval.");
  process.exit(2);
}
const auth: AuthContext = { type: "firebase", token: gcKey, source: "raw" };
const ctx: ToolContext = { auth };

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
};

// --- The languages under test -------------------------------------------------------------

const LEARNOSITY = ["L0158", "L0176", "L0177"];
const norm = (id: string) => `L${id.replace(/^L/i, "").padStart(4, "0")}`.toUpperCase();

// --- A. Catalog invariants (deterministic, no model) ---------------------------------------

async function catalogInvariants() {
  console.log("\n=== Catalog invariants (live console) ===");

  const ids = async (args: { domain?: string; search?: string }) => {
    const res = (await handleListLanguages(ctx, args)) as { languages: any[] };
    return res.languages.map((l) => norm(l.id));
  };

  const assessments = await ids({ domain: "assessments" });
  check(
    "domain:assessments excludes the Learnosity languages",
    !assessments.some((id) => LEARNOSITY.includes(id)),
    `got ${assessments.join(", ")}`,
  );

  const learnosity = await ids({ domain: "learnosity" });
  check(
    "domain:learnosity contains L0176 (item content) and L0158 (deprecated)",
    learnosity.includes("L0176") && learnosity.includes("L0158"),
    `got ${learnosity.join(", ")}`,
  );

  for (const term of ["quiz", "multiple choice", "assessment", "test"]) {
    const hits = await ids({ search: term });
    check(
      `search:"${term}" returns no Learnosity language`,
      !hits.some((id) => LEARNOSITY.includes(id)),
      `got ${hits.join(", ") || "(none)"}`,
    );
  }

  // The gate must not make them undiscoverable to someone who actually wants Learnosity.
  const branded = await ids({ search: "learnosity" });
  check(
    'search:"learnosity" still finds them',
    branded.includes("L0176"),
    `got ${branded.join(", ") || "(none)"}`,
  );

  const withHints = (await handleListLanguages(ctx, { domain: "assessments" })) as {
    languages: Array<{ id: string; when_to_use?: string }>;
  };
  const missing = withHints.languages.filter((l) => !l.when_to_use).map((l) => norm(l.id));
  check(
    "every assessments language ships a when_to_use on the wire",
    missing.length === 0,
    missing.length ? `missing on ${missing.join(", ")}` : "",
  );

  const l0176 = (await handleGetLanguageInfo(ctx, { language: "L0176" })) as {
    description: string;
    when_to_use?: string;
    not_for?: string[];
  };
  const gateText = `${l0176.description} ${l0176.when_to_use ?? ""}`.toLowerCase();
  check(
    "get_language_info(L0176) states the Learnosity-only gate",
    gateText.includes("only when") && gateText.includes("learnosity"),
    l0176.description,
  );
  // not_for comes from the language server's scope.json, fetched through the API gateway. In local
  // dev that gateway is often unreachable (.env.local points NEXT_PUBLIC_GC_API_URL at
  // localhost:3100), and every language's scope comes back null. Report that as "could not run"
  // rather than failing — a silent null here is an environment problem, not a catalog regression.
  if ((l0176.not_for?.length ?? 0) === 0) {
    console.log(
      "SKIP  get_language_info(L0176) surfaces not_for — no scope from the language server " +
        "(unreachable lang-server assets; point NEXT_PUBLIC_GC_API_URL at a live API gateway)",
    );
  } else {
    check("get_language_info(L0176) surfaces not_for (out-of-scope)", true, `${l0176.not_for!.length} entries`);
  }
}

// --- B. Routing eval (model in the loop) ----------------------------------------------------

interface Case {
  prompt: string;
  expect?: string;      // must route here
  expectNot?: string[]; // must NOT route here (asking the user is an acceptable outcome)
  why?: string;
}

const CASES: Case[] = [
  // The regression this change exists to fix.
  { prompt: "Make a 5-question multiple-choice quiz on the water cycle.", expectNot: LEARNOSITY, why: "generic quiz" },
  { prompt: "Create a short quiz to test my students on photosynthesis.", expectNot: LEARNOSITY, why: "generic quiz" },
  { prompt: "Write a cloze fill-in-the-blank item about mitosis.", expectNot: LEARNOSITY, why: "question type is not the discriminator" },
  // Learnosity is named — it must still win.
  // Each names Learnosity AND specifies the content — so routing is the only open question. (An
  // underspecified prompt like "I need an item for our Learnosity item bank" makes a good agent
  // ask what the item is about, which tells us nothing about routing.)
  { prompt: "Author a Learnosity MCQ on adding fractions.", expect: "L0176" },
  {
    prompt:
      "I need an item for our Learnosity item bank: a grade 8 multiple-choice question on the " +
      "causes of the American Civil War, four options, one correct.",
    expect: "L0176",
  },
  {
    prompt:
      "Make a quiz item for our LMS — we use the Learnosity Items API. A short-text question " +
      "asking students which organelle is the powerhouse of the cell.",
    expect: "L0176",
  },
  // The specialists must still be reachable.
  { prompt: "Grade 5 ELA reading item on citing evidence from an informational passage.", expect: "L0175" },
  { prompt: "Flashcards for Spanish vocabulary — 10 common food words with their English translations.", expect: "L0159" },
  { prompt: "A spreadsheet problem where students compute column totals with SUM.", expect: "L0166" },
  { prompt: "Area model multiplication question with a visual grid.", expect: "L0153" },
  { prompt: "A map question asking students to click state capitals.", expect: "L0152" },
];

function loadSkill(name: string): string {
  const path = resolve(SKILLS_REPO, name, "SKILL.md");
  try {
    return readFileSync(path, "utf8");
  } catch {
    console.error(`Could not read ${path}. Set GRAFFITICODE_SKILLS_PATH to the skills repo.`);
    process.exit(2);
  }
}

// Stub create_item: record the routing decision and stop. Nothing is generated.
const createItemStub = {
  name: "create_item",
  description:
    "Create interactive content in a Graffiticode language. Call list_languages() first to " +
    "discover available languages, then pass the language ID here.",
  input_schema: {
    type: "object" as const,
    properties: {
      language: { type: "string", description: "Language ID (e.g., 'L0166')" },
      description: { type: "string", description: "Natural language description of what to create" },
    },
    required: ["language", "description"],
  },
};

// The escape hatch: an agent with no good match should ASK, not force the closest language.
const askUserStub = {
  name: "ask_user",
  description:
    "Ask the user a clarifying question. Use this when no available Graffiticode language fits " +
    "the request, instead of forcing the closest match.",
  input_schema: {
    type: "object" as const,
    properties: { question: { type: "string" } },
    required: ["question"],
  },
};

type Outcome =
  | { kind: "create"; language: string }
  | { kind: "ask"; question: string }
  | { kind: "none"; text: string };

async function routeOnce(client: Anthropic, prompt: string, system: string): Promise<Outcome> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  const tools = [
    { name: listLanguagesTool.name, description: listLanguagesTool.description, input_schema: listLanguagesTool.inputSchema },
    { name: getLanguageInfoTool.name, description: getLanguageInfoTool.description, input_schema: getLanguageInfoTool.inputSchema },
    createItemStub,
    askUserStub,
  ] as Anthropic.Tool[];

  for (let turn = 0; turn < 8; turn++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system,
      tools,
      messages,
    });

    const sayText = () =>
      res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join(" ")
        .trim();

    const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (calls.length === 0) return { kind: "none", text: sayText() };

    // A routing decision ends the run.
    for (const call of calls) {
      if (call.name === "create_item") {
        return { kind: "create", language: norm(String((call.input as any).language ?? "")) };
      }
      if (call.name === "ask_user") {
        return { kind: "ask", question: String((call.input as any).question ?? "") };
      }
    }

    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of calls) {
      let out: unknown;
      try {
        out =
          call.name === "list_languages"
            ? await handleListLanguages(ctx, call.input as any)
            : await handleGetLanguageInfo(ctx, call.input as any);
      } catch (err) {
        out = { error: String(err) };
      }
      results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out) });
    }
    messages.push({ role: "user", content: results });
  }
  return { kind: "none", text: "(tool-loop exhausted)" };
}

async function routingEval() {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.error("Set ANTHROPIC_API_KEY to run the routing eval (or pass --catalog-only).");
    process.exit(2);
  }
  const client = new Anthropic({ apiKey: anthropicKey });

  // The real agent-facing surface: server instructions + the two skills that teach discovery.
  const system = [
    SERVER_INSTRUCTIONS,
    "\n\n--- Skill: assessments ---\n",
    loadSkill("assessments"),
    "\n\n--- Skill: learnosity ---\n",
    loadSkill("learnosity"),
  ].join("");

  console.log(`\n=== Routing eval (${MODEL}, ${RUNS_PER_CASE} runs/case) ===`);

  for (const c of CASES) {
    const outcomes = await Promise.all(
      Array.from({ length: RUNS_PER_CASE }, () => routeOnce(client, c.prompt, system)),
    );

    const summarize = (o: Outcome) =>
      o.kind === "create" ? o.language : o.kind === "ask" ? "ASKED" : "no-call";
    const detail = outcomes.map(summarize).join(", ");

    // A non-routing outcome is only meaningful if you can read what it said — print it so a
    // "no-call" that quietly authored a quiz in chat can't hide behind a green check.
    if (process.env.EVAL_VERBOSE) {
      for (const o of outcomes) {
        if (o.kind === "ask") console.log(`        ASKED: ${o.question.slice(0, 220)}`);
        if (o.kind === "none") console.log(`        SAID:  ${o.text.slice(0, 220)}`);
      }
    }

    if (c.expect) {
      const ok = outcomes.every((o) => o.kind === "create" && o.language === c.expect);
      check(`${c.expect}  "${c.prompt}"`, ok, detail);
    } else {
      // Must not land on a gated language. Asking the user is a pass — that's the intended
      // behavior when no specialist fits.
      const ok = outcomes.every(
        (o) => !(o.kind === "create" && c.expectNot!.includes(o.language)),
      );
      check(`not-Learnosity  "${c.prompt}"${c.why ? ` (${c.why})` : ""}`, ok, detail);
    }
  }
}

async function main() {
  await catalogInvariants();
  if (!catalogOnly) await routingEval();

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
