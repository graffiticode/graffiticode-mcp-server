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

export interface TableContent {
  kind: "table";
  sheetName?: string;
  headers: string[];
  rows: string[][];
  /** Data rows in the sheet, before the display cap. */
  totalRows: number;
  /** Sheets in the workbook; >1 means the table below is only the first. */
  totalSheets: number;
}

export interface ChartContent {
  kind: "chart";
  chartType?: string;
  title?: string;
  categories: string[];
  series: { name?: string; values: string[] }[];
}

export interface ConceptWebContent {
  kind: "conceptweb";
  topic?: string;
  instructions?: string;
  concepts: string[];
  links: { from: string; to: string; label?: string }[];
}

export type ItemContent =
  | { kind: "questions"; count: number; shown: QuestionSummary[] }
  | TableContent
  | ChartContent
  | ConceptWebContent
  | { kind: "prose"; text: string }
  | { kind: "preview"; json: string }
  | { kind: "empty" };

/** How many questions to show before saying "and N more". The rest is one line. */
const QUESTIONS_SHOWN = 8;
/** A spec document is the item; show enough to judge it, not the whole thing. */
const PROSE_CAP = 4000;
/** The generic JSON preview. Widget-only — see contentToMarkdown. */
const PREVIEW_CAP = 2000;
/** Table display caps. Enough to show the shape and judge the content. */
const MAX_TABLE_ROWS = 12;
const MAX_TABLE_COLS = 8;
/** Chart categories and concept-web edges: enough to read the thing, not all of it. */
const MAX_SERIES_POINTS = 12;
const MAX_LINKS = 12;

/**
 * Whether a result status is the LAST word on an item.
 *
 * Only "generating" is non-terminal. This exists as its own exported predicate
 * because getting it wrong is invisible and expensive: the widget used to latch
 * on the first result of any kind, and `render_item` returns
 * `{ status: "generating" }` whenever its own poll deadline expires — so a slow
 * item rendered "Generating…" and then ignored the `ready` that followed, with no
 * error and no way out but a reload.
 *
 * An ABSENT status counts as terminal. A ready result carries `status: "ready"`
 * today, but older payloads and the raw get_item shape omit it, and treating
 * "no status" as non-terminal would leave those waiting forever for a second
 * delivery that never comes. Erring toward terminal costs at most a missed
 * re-render; erring the other way is the bug this replaced.
 */
export function isTerminalStatus(status?: string): boolean {
  return status !== "generating";
}

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

/** "B12" -> { col: "B", row: 12 }. Anything else is not a cell address. */
function parseCellRef(ref: string): { col: string; row: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  return m ? { col: m[1], row: Number(m[2]) } : null;
}

/** Spreadsheet column order: A..Z, then AA.. — length first, then alphabetical. */
function compareCols(a: string, b: string): number {
  return a.length - b.length || a.localeCompare(b);
}

/**
 * Find the cell map in a compiled spreadsheet, wherever the dialect puts it.
 *
 * Written this way because the first attempt guessed `data.sheets[].cells` from a
 * log excerpt and shipped: L0179 actually compiles a single table to
 * `data.interaction.cells`, so the branch never fired against a real item and
 * spreadsheets went out with no content at all. Rather than swap one guess for
 * another, this probes the known containers and VERIFIES the result really is
 * cell-address-keyed before accepting it — a container that doesn't hold cells is
 * not a match, so a wrong guess degrades to the next candidate instead of to
 * nonsense.
 */
function findCellMap(data: Record<string, unknown>): {
  cells: Record<string, unknown>;
  name?: string;
  totalSheets: number;
} | null {
  const looksLikeCells = (v: unknown): v is Record<string, unknown> =>
    isRecord(v) && Object.keys(v).some((k) => parseCellRef(k) !== null);

  const interaction = isRecord(data.interaction) ? data.interaction : undefined;
  if (looksLikeCells(interaction?.cells)) {
    return { cells: interaction!.cells as Record<string, unknown>, totalSheets: 1 };
  }
  if (looksLikeCells(data.cells)) {
    return { cells: data.cells as Record<string, unknown>, totalSheets: 1 };
  }
  if (Array.isArray(data.sheets)) {
    const sheets = data.sheets.filter(isRecord);
    const first = sheets.find((sh) => looksLikeCells(sh.cells));
    if (first) {
      return {
        cells: first.cells as Record<string, unknown>,
        name: typeof first.name === "string" ? first.name : undefined,
        totalSheets: sheets.length,
      };
    }
  }
  return null;
}

/**
 * Turn a compiled cell map into a table.
 *
 * Cells are keyed by address (`{ A1: { text }, … }`), which is a rendering detail
 * and not something a reader should ever be shown. Row 1 is treated as the header
 * — the convention these languages generate — and when that doesn't hold the first
 * row merely reads as a header, a far smaller error than printing the raw object.
 */
function cellsToTable(
  cells: Record<string, unknown>,
  sheetName: string | undefined,
  totalSheets: number
): TableContent | null {

  const byRow = new Map<number, Map<string, string>>();
  const cols = new Set<string>();
  for (const [ref, cell] of Object.entries(cells)) {
    const at = parseCellRef(ref);
    if (!at) continue;
    const text = isRecord(cell) ? String(cell.text ?? "") : String(cell ?? "");
    if (!byRow.has(at.row)) byRow.set(at.row, new Map());
    byRow.get(at.row)!.set(at.col, text);
    cols.add(at.col);
  }
  if (!byRow.size) return null;

  const orderedCols = [...cols].sort(compareCols).slice(0, MAX_TABLE_COLS);
  const orderedRows = [...byRow.keys()].sort((a, b) => a - b);
  const readRow = (r: number) => orderedCols.map((c) => byRow.get(r)?.get(c) ?? "");

  const [headerRow, ...dataRows] = orderedRows;
  return {
    kind: "table",
    sheetName,
    headers: readRow(headerRow),
    rows: dataRows.slice(0, MAX_TABLE_ROWS).map(readRow),
    totalRows: dataRows.length,
    totalSheets,
  };
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

  // Charts compile to an ECharts `option`. A category axis plus one or more series
  // IS a table — the same numbers the picture draws — so it is presented as one
  // rather than described in the abstract ("a bar chart with 4 points" tells a
  // reader nothing they can check).
  if (data && data.type === "chart" && isRecord(data.option)) {
    const option = data.option;
    const xAxis = isRecord(option.xAxis) ? option.xAxis : undefined;
    const categories = Array.isArray(xAxis?.data) ? xAxis!.data.map(String) : [];
    const rawSeries = Array.isArray(option.series) ? option.series : [];
    const series = rawSeries.filter(isRecord).map((sr) => ({
      name: typeof sr.name === "string" ? sr.name : undefined,
      values: Array.isArray(sr.data) ? sr.data.map((v) => (v == null ? "" : String(v))) : [],
    }));
    if (series.some((sr) => sr.values.length)) {
      const title = isRecord(option.title) && typeof option.title.text === "string"
        ? option.title.text
        : undefined;
      const chartType = series.find((_, i) => isRecord(rawSeries[i]))
        ? (rawSeries.find(isRecord) as Record<string, unknown>).type
        : undefined;
      return {
        kind: "chart",
        chartType: typeof chartType === "string" ? chartType : undefined,
        title,
        categories: categories.slice(0, MAX_SERIES_POINTS),
        series: series.map((sr) => ({ ...sr, values: sr.values.slice(0, MAX_SERIES_POINTS) })),
      };
    }
  }

  // Concept webs: an anchor, its connected concepts, and labelled edges between
  // them. The labels carry the actual teaching content, so they are the point.
  if (data && isRecord(data.conceptWeb)) {
    const web = data.conceptWeb;
    const anchor = isRecord(web.anchor) ? String(web.anchor.text ?? web.anchor.value ?? "") : "";
    const connections = Array.isArray(web.connections)
      ? web.connections.filter(isRecord).map((c) => String(c.text ?? c.value ?? "")).filter(Boolean)
      : [];
    const edges = Array.isArray(web.edges) ? web.edges.filter(isRecord) : [];
    const links = edges
      // `to: "*"` is the anchor's radial fan-out — layout, not content.
      .filter((e) => e.to !== "*")
      .slice(0, MAX_LINKS)
      .map((e) => ({
        from: String(e.from ?? ""),
        to: String(e.to ?? ""),
        label: typeof e.text === "string" && e.text ? e.text : undefined,
      }));
    if (connections.length || links.length) {
      return {
        kind: "conceptweb",
        topic: (typeof web.topic === "string" && web.topic) || anchor || undefined,
        instructions: typeof web.instructions === "string" ? web.instructions : undefined,
        concepts: connections,
        links,
      };
    }
  }

  // Spreadsheets. Matched on SHAPE rather than language id, so L0166, its
  // successor L0179, and any future cell-addressed dialect all read correctly
  // without an entry here.
  if (data) {
    const found = findCellMap(data);
    if (found) {
      const table = cellsToTable(found.cells, found.name, found.totalSheets);
      if (table) return table;
    }
  }

  // Everything else. `preview` is a WIDGET-only shape — contentToMarkdown refuses
  // to put it in chat. See the note there.
  if (data) return { kind: "preview", json: JSON.stringify(data, null, 2).slice(0, PREVIEW_CAP) };
  return { kind: "empty" };
}

/** Markdown table cells are pipe-delimited, so a pipe in the data ends the cell. */
function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

/**
 * Render the content model as Markdown, for the tool result's text block.
 *
 * Every client renders this — it is the one representation guaranteed to arrive,
 * so it is also the fallback when a widget fails to mount.
 *
 * `preview` returns "" ON PURPOSE. It is a raw `JSON.stringify` of the compiled
 * data, which is a fine last resort inside a scrollable panel in the widget and is
 * never acceptable in a chat message: a real spreadsheet's compiled form is mostly
 * hex fills and column widths, and it would reach the user as a wall of machine
 * output. A title and a link say less but do not insult the reader. So chat gets
 * content only where we can present it as content — questions, a table, prose —
 * and the dump stays behind in the widget where the shape came from.
 *
 * `empty` returns "" for the same reason: the caller already prints a title and a
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
    case "table": {
      const { headers, rows, totalRows, totalSheets, sheetName } = content;
      const width = headers.length;
      const pad = (cells: string[]) =>
        Array.from({ length: width }, (_, i) => escapeCell(cells[i] ?? ""));
      const lines: string[] = [];
      // The sheet's own name earns its place only when there is more than one, to
      // say WHICH sheet this is. On a single-sheet workbook it just repeats the
      // item title the caller printed a line above.
      if (sheetName && totalSheets > 1) lines.push(`**${sheetName}**`, "");
      lines.push(`| ${pad(headers).join(" | ")} |`);
      lines.push(`| ${Array.from({ length: width }, () => "---").join(" | ")} |`);
      for (const r of rows) lines.push(`| ${pad(r).join(" | ")} |`);
      const notes: string[] = [];
      const hiddenRows = totalRows - rows.length;
      if (hiddenRows > 0) notes.push(`${hiddenRows} more row${hiddenRows === 1 ? "" : "s"}`);
      if (totalSheets > 1) {
        notes.push(`${totalSheets - 1} more sheet${totalSheets === 2 ? "" : "s"}`);
      }
      if (notes.length) lines.push("", `…and ${notes.join(", ")}.`);
      return lines.join("\n");
    }
    case "chart": {
      const { title, chartType, categories, series } = content;
      const lines: string[] = [];
      const heading = [title && `**${title}**`, chartType && `${chartType} chart`]
        .filter(Boolean)
        .join(" — ");
      if (heading) lines.push(heading, "");
      const named = series.map((sr, i) => sr.name ?? (series.length > 1 ? `Series ${i + 1}` : "Value"));
      lines.push(`| | ${named.map(escapeCell).join(" | ")} |`);
      lines.push(`| --- | ${named.map(() => "---").join(" | ")} |`);
      const rowCount = Math.max(categories.length, ...series.map((sr) => sr.values.length));
      for (let i = 0; i < rowCount; i++) {
        const label = escapeCell(categories[i] ?? String(i + 1));
        lines.push(`| ${label} | ${series.map((sr) => escapeCell(sr.values[i] ?? "")).join(" | ")} |`);
      }
      return lines.join("\n");
    }
    case "conceptweb": {
      const { topic, instructions, concepts, links } = content;
      const lines: string[] = [];
      if (topic) lines.push(`**${topic}** — concept web`, "");
      if (instructions) lines.push(instructions, "");
      if (concepts.length) lines.push(`Concepts: ${concepts.join(", ")}`, "");
      for (const l of links) {
        lines.push(`- ${l.from} → ${l.to}${l.label ? ` — ${l.label}` : ""}`);
      }
      return lines.join("\n").trim();
    }
    case "prose":
      return content.text;
    case "preview":
      return "";
    case "empty":
      return "";
  }
}
