/**
 * What an item actually contains, extracted once and rendered twice.
 *
 * This logic used to live only in the widget (`cardBody` in
 * `widget/browser/renderer.ts`), which meant it reached Claude and nobody else. A
 * ChatGPT user's whole experience of a finished item was one line — a name, a
 * language, and a link — because the hydration payload carrying `data` is stripped
 * for hosts that render no widget. An OpenAI reviewer could not check a single
 * documented outcome without leaving the conversation, and said so.
 *
 * So the extraction is separated from the presentation. `describeItem` turns an
 * item's compiled `data` into a small content model; the widget renders that model
 * as DOM, and `contentToMarkdown` renders the same model into the tool result's
 * text, where every client can see it. One extraction, two emitters — a shape that
 * renders in the widget but reads as a blank line in the transcript is now a thing
 * that cannot happen.
 *
 * Deliberately DOM-free and dependency-free: it is compiled by `tsc` for the server
 * (whose `lib` is ES2022, with no DOM types at all) and bundled by esbuild for the
 * browser. Keep it that way — the moment this file touches `document`, the server
 * half stops compiling.
 */

/** The two halves of a tool result the widget sees. Structural, so the browser's
 *  `ToolResult` satisfies it without importing anything from this module's side. */
export interface ToolPayload {
  structuredContent: Record<string, unknown>;
  meta: Record<string, unknown>;
}

export interface QuestionSummary {
  stimulus: string;
  options: { label: string; correct: boolean }[];
}

export type ItemContent =
  | { kind: "questions"; count: number; shown: QuestionSummary[] }
  | { kind: "prose"; text: string }
  | { kind: "preview"; json: string }
  | { kind: "empty" };

/** How many questions to show before saying "and N more". The rest is one line. */
const QUESTIONS_SHOWN = 8;
/** A spec document is the item; show enough to judge it, not the whole thing. */
const PROSE_CAP = 4000;
/** The generic JSON preview. Large enough to be evidence, small enough to skim. */
const PREVIEW_CAP = 2000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeLang(lang: unknown): string {
  return `L${String(lang ?? "").replace(/^[lL]/, "")}`;
}

/** Merge the model-visible result with the namespaced widget hydration payload. */
export function mergeToolPayload(r: ToolPayload): Record<string, unknown> {
  const namespaced = isRecord(r.meta.graffiticode) ? r.meta.graffiticode : r.meta;
  return { ...r.structuredContent, ...namespaced };
}

/** Compiled data arrives wrapped in a `{ data, errors }` envelope for some langs. */
export function unwrapData(raw: unknown): unknown {
  if (isRecord(raw) && ("data" in raw || "errors" in raw)) return raw.data;
  return raw;
}

/**
 * Describe an item from its compiled `data`.
 *
 * `sc` is the merged payload (structuredContent + hydration), so this reads `data`
 * and, for the spec language, falls back to `spec`/`src`. Shapes were verified
 * against the language compilers; the fallback chains inside each branch are load
 * bearing (a question's text is `stimulus` OR `prompt`, an option's is `label` OR
 * `value`, and Learnosity spells its answer key both `valid-response` and
 * `validResponse` depending on vintage).
 */
export function describeItem(lang: string, sc: Record<string, unknown>): ItemContent {
  const unwrapped = unwrapData(sc.data);
  const data = isRecord(unwrapped) ? unwrapped : undefined;

  // Learnosity assessments: data = { type, request: { questions: [...] } }.
  if ((lang === "L0158" || lang === "L0176") && data) {
    const request = data.request as { questions?: unknown[] } | undefined;
    const questions = Array.isArray(request?.questions) ? request!.questions : [];
    if (questions.length) {
      const shown = questions.slice(0, QUESTIONS_SHOWN).map((q): QuestionSummary => {
        const qq = q as Record<string, unknown>;
        // Stimulus is authored as HTML; the tags are markup, not content, and
        // survive into neither a card nor a chat message intelligibly.
        const stimulus = String(qq.stimulus ?? qq.prompt ?? "")
          .replace(/<[^>]+>/g, "")
          .trim();
        const valid = (qq["valid-response"] ?? qq.validResponse) as
          | Record<string, unknown>
          | undefined;
        const correct = new Set(
          Array.isArray(valid?.value) ? (valid!.value as unknown[]).map(String) : []
        );
        const opts = qq.options as Array<Record<string, unknown>> | undefined;
        return {
          stimulus: stimulus || "(question)",
          options: Array.isArray(opts)
            ? opts.map((o) => ({
                label: String(o.label ?? o.value ?? ""),
                correct: correct.has(String(o.value)),
              }))
            : [],
        };
      });
      return { kind: "questions", count: questions.length, shown };
    }
  }

  // Spec doc: the item IS prose.
  if (lang === "L0177") {
    const text = String((data?.print ?? sc.spec ?? sc.src ?? "") || "");
    if (text) return { kind: "prose", text: text.slice(0, PROSE_CAP) };
  }

  // Everything else: a compact, readable preview of the data we have.
  if (data) return { kind: "preview", json: JSON.stringify(data, null, 2).slice(0, PREVIEW_CAP) };
  return { kind: "empty" };
}

/**
 * Render the content model as Markdown, for the tool result's text block.
 *
 * Every client renders this — it is the one representation guaranteed to arrive,
 * so it is also the fallback when a widget fails to mount. Returns "" for `empty`
 * rather than a placeholder sentence: the caller already prints a title and a
 * link, and "no content" is better said by absence than by a line of apology.
 */
export function contentToMarkdown(content: ItemContent): string {
  switch (content.kind) {
    case "questions": {
      const { count, shown } = content;
      const lines = [`**${count} question${count === 1 ? "" : "s"}**`, ""];
      shown.forEach((q, i) => {
        lines.push(`${i + 1}. ${q.stimulus}`);
        for (const o of q.options) {
          // The check mark is the answer key. It is the single most useful thing
          // in the summary for anyone verifying that the item is correct.
          lines.push(`   - ${o.correct ? "✓ " : ""}${o.label}`);
        }
      });
      const remaining = count - shown.length;
      if (remaining > 0) lines.push("", `…and ${remaining} more.`);
      return lines.join("\n");
    }
    case "prose":
      return content.text;
    case "preview":
      return ["```json", content.json, "```"].join("\n");
    case "empty":
      return "";
  }
}
