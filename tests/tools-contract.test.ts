import assert from "node:assert/strict";
import test from "node:test";
import {
  OPTIONAL_AUTH_SECURITY_SCHEMES,
  getItemTool,
  parseHelp,
  renderItemTool,
  tools,
  toolsForClient,
} from "../src/tools.js";

type ToolRecord = Record<string, unknown> & { name: string };

const NON_CLAUDE_CLIENTS = ["ChatGPT", "openai-apps", "codex-mcp-client", "web-sandbox", "gpt", "some-unknown-host", undefined as unknown as string];
const WIDGET_TOOLS = new Set(["render_item", "get_item"]);
const expectedSchemes = JSON.parse(JSON.stringify(OPTIONAL_AUTH_SECURITY_SCHEMES));

function metaOf(tool: ToolRecord): Record<string, unknown> {
  return tool._meta as Record<string, unknown>;
}

test("every structured tool declares an output schema", () => {
  for (const tool of tools as ToolRecord[]) {
    assert.ok(tool.outputSchema, `${tool.name} is missing outputSchema`);
  }
});

test("every tool advertises optional-auth securitySchemes to every client (incl. unknowns)", () => {
  for (const client of ["claude-ai", ...NON_CLAUDE_CLIENTS]) {
    for (const tool of toolsForClient(client) as ToolRecord[]) {
      // top-level descriptor field
      assert.deepEqual(tool.securitySchemes, expectedSchemes, `${client}/${tool.name} top-level securitySchemes`);
      // _meta mirror (compatibility)
      assert.deepEqual(metaOf(tool).securitySchemes, expectedSchemes, `${client}/${tool.name} _meta.securitySchemes`);
    }
  }
});

test("non-Claude clients (incl. unknowns) get securitySchemes but NO widget/UI metadata", () => {
  // Whitelist semantics: the widget goes to verified MCP Apps hosts (Claude) only.
  // Covers client names a naive OpenAI blacklist would MISS — the ChatGPT consumer app
  // and any unknown client — which is why the widget leaked before. But securitySchemes
  // must survive so OpenAI's Scan Tools sees the optional-auth contract.
  for (const client of NON_CLAUDE_CLIENTS) {
    for (const tool of toolsForClient(client) as ToolRecord[]) {
      const meta = metaOf(tool);
      assert.equal(meta.ui, undefined, `${client}/${tool.name} leaked ui`);
      assert.equal(meta["ui/resourceUri"], undefined, `${client}/${tool.name} leaked ui/resourceUri`);
      assert.equal(meta["openai/resultCanProduceWidget"], undefined, `${client}/${tool.name} leaked widget hint`);
      assert.deepEqual(Object.keys(meta), ["securitySchemes"], `${client}/${tool.name} _meta should be securitySchemes-only`);
    }
  }
});

test("Claude receives the MCP App resource on widget-bearing tools, plus securitySchemes on all", () => {
  const listed = toolsForClient("claude-ai") as ToolRecord[];
  for (const tool of listed) {
    const meta = metaOf(tool);
    assert.deepEqual(meta.securitySchemes, expectedSchemes);
    if (!WIDGET_TOOLS.has(tool.name)) {
      // non-widget tools: securitySchemes only, no ui
      assert.equal(meta.ui, undefined, `${tool.name} should have no widget`);
      continue;
    }
    const ui = meta.ui as { resourceUri?: string };
    assert.match(ui.resourceUri ?? "", /^ui:\/\/graffiticode\/widget-mcp\.[a-f0-9]{8}\.html$/);
    assert.equal(meta["ui/resourceUri"], ui.resourceUri);
    assert.equal(meta["openai/resultCanProduceWidget"], undefined, "openai marker replaced by ui.resourceUri for Claude");
  }
});

test("render_item is compact while get_item preserves the legacy raw contract", () => {
  const renderProperties = (renderItemTool.outputSchema.properties ?? {}) as Record<string, unknown>;
  const rawProperties = (getItemTool.outputSchema.properties ?? {}) as Record<string, unknown>;
  assert.equal(renderProperties.src, undefined);
  assert.equal(renderProperties.data, undefined);
  assert.ok(rawProperties.src);
  assert.ok(rawProperties.data);
});

test("parseHelp rejects valid JSON that is not an array", () => {
  assert.deepEqual(parseHelp('{"user":"not history"}'), []);
  assert.deepEqual(parseHelp("null"), []);
  assert.equal(parseHelp('[{"user":"hello"}]').length, 1);
});
