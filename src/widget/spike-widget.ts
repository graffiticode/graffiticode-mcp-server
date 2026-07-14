/**
 * SPIKE widget HTML — temporary. Delete once the loading strategy is settled.
 *
 * Served only when WIDGET_SPIKE=1, under its own resource URIs, so it cannot
 * affect the production widgets. See `browser/spike.ts` for what it measures.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BUNDLE_URL = new URL("./spike.bundle.js", import.meta.url);

/**
 * One case per registered language: a real `data` object in the shape that
 * language's compiler emits, plus what a successful render looks like.
 *
 * The assertion differs by language because the output does: l0166 renders a
 * spreadsheet as DOM text, while l0173 paints an ECharts chart to a <canvas> and
 * produces no text at all. Static fixtures, so the probe needs no network or bridge.
 */
const CASES = [
  {
    // l0166 compiler output: title/instructions/validation/interaction.cells.
    id: "L0166",
    needles: ["Rent", "Groceries", "Savings"],
    data: {
      title: "Monthly Budget",
      instructions: "Enter a formula in the Total cell.",
      validation: { points: 0, regions: {}, cells: {} },
      interaction: {
        type: "table",
        cells: {
          A1: { text: "Category" },
          B1: { text: "Amount" },
          A2: { text: "Rent" },
          B2: { text: "1200" },
          A3: { text: "Groceries" },
          B3: { text: "400" },
          A4: { text: "Savings" },
          B4: { text: "300" },
          A5: { text: "Total" },
          B5: { text: "=SUM(B2:B4)" },
        },
      },
    },
  },
  {
    // l0173 renders `{ type: "chart", option }` through ECharts — canvas, not text.
    id: "L0173",
    graphic: true,
    data: {
      type: "chart",
      theme: "light",
      width: 440,
      height: 240,
      option: {
        title: { text: "Monthly Spend" },
        tooltip: {},
        xAxis: { type: "category", data: ["Rent", "Groceries", "Savings"] },
        yAxis: { type: "value" },
        series: [{ type: "bar", name: "USD", data: [1200, 400, 300] }],
      },
    },
  },
];

let cached: string | null = null;

function loadBundle(): string {
  if (cached === null) {
    cached = readFileSync(fileURLToPath(BUNDLE_URL), "utf8");
  }
  return cached;
}

/** @param origin absolute origin serving /widget/lang/*.mjs (must match the CSP resourceDomains) */
export function generateSpikeWidgetHtml(origin: string): string {
  const script = loadBundle();
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 12px; background: #fff; color: #111; }
    h1 { font-size: 13px; margin-bottom: 8px; }
    .row { padding: 2px 0; }
    .tag { display: inline-block; width: 44px; font-weight: 700; }
    .ok .tag { color: #15803d; }
    .fail .tag { color: #b91c1c; }
    .info .tag { color: #6b7280; }
    pre { margin: 8px 0; padding: 8px; background: #f3f4f6; border-radius: 6px; white-space: pre-wrap; font-size: 11px; }
    #stages { margin-top: 12px; border-top: 1px solid #e5e7eb; padding-top: 12px; }
    .stage { margin-bottom: 16px; }
  </style>
</head>
<body>
  <h1>Graffiticode widget loading spike</h1>
  <div id="out"></div>
  <div id="stages"></div>
  <script>
    window.__MCP_ORIGIN__ = ${JSON.stringify(origin)};
    window.__CASES__ = ${JSON.stringify(CASES)};
  </script>
  <script>${script}</script>
</body>
</html>`;
}
