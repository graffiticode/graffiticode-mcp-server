import assert from "node:assert/strict";
import test from "node:test";
import {
  getItemTool,
  parseHelp,
  renderItemTool,
  tools,
  toolsForClient,
} from "../src/tools.js";

type ToolRecord = Record<string, unknown> & { name: string };

test("every structured tool declares an output schema", () => {
  for (const tool of tools as ToolRecord[]) {
    assert.ok(tool.outputSchema, `${tool.name} is missing outputSchema`);
  }
});

test("OpenAI clients receive no widget metadata", () => {
  for (const client of ["ChatGPT", "openai-apps", "codex-mcp-client"]) {
    for (const tool of toolsForClient(client) as ToolRecord[]) {
      assert.equal(tool._meta, undefined, `${client}/${tool.name} exposes widget metadata`);
    }
  }
});

test("Claude receives the MCP App resource on widget-bearing tools", () => {
  const listed = toolsForClient("claude-ai") as ToolRecord[];
  // Only retrieval tools are widget-bearing: create_item/update_item return
  // "generating" and can't update to the result, so they'd leave a stuck card.
  const widgetTools = new Set(["render_item", "get_item"]);
  for (const tool of listed) {
    const meta = tool._meta as Record<string, unknown> | undefined;
    if (!widgetTools.has(tool.name)) {
      assert.equal(meta, undefined);
      continue;
    }
    assert.ok(meta);
    const ui = meta.ui as { resourceUri?: string };
    assert.match(ui.resourceUri ?? "", /^ui:\/\/graffiticode\/widget-mcp\.[a-f0-9]{8}\.html$/);
    assert.equal(meta["ui/resourceUri"], ui.resourceUri);
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
