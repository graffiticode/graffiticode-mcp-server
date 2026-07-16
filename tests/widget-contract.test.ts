import assert from "node:assert/strict";
import test from "node:test";
import { mergeToolPayload } from "../src/widget/browser/renderer.js";
import {
  CLAUDE_WIDGET_MIME_TYPE,
  matchWidgetUri,
  widgetCsp,
  widgetResourceUris,
} from "../src/widget/index.js";

test("current and historical Claude widget URIs resolve with a strict hash", () => {
  assert.equal(matchWidgetUri(widgetResourceUris().mcp), "mcp");
  assert.equal(matchWidgetUri("ui://graffiticode/widget-mcp.deadbeef.html"), "mcp");
  assert.equal(matchWidgetUri("ui://graffiticode/claude-form-widget.html"), "mcp");
  assert.equal(matchWidgetUri("ui://graffiticode/widget-mcp.anything.html"), null);
  assert.equal(matchWidgetUri("ui://graffiticode/widget-mcp.deadbeef00.html"), null);
});

test("retired OpenAI widget pointers are classified but not confused with MCP Apps", () => {
  assert.equal(matchWidgetUri("ui://graffiticode/form-widget.html"), "openai");
  assert.equal(matchWidgetUri("ui://graffiticode/widget-oai.cafebabe.html"), "openai");
  assert.equal(CLAUDE_WIDGET_MIME_TYPE, "text/html;profile=mcp-app");
});

test("Claude CSP declares only the component bundle origin", () => {
  const csp = widgetCsp();
  assert.deepEqual(Object.keys(csp.camel), ["resourceDomains"]);
  assert.deepEqual(Object.keys(csp.snake), ["resource_domains"]);
});

test("renderer merges namespaced hydration with compact structured content", () => {
  const merged = mergeToolPayload({
    structuredContent: {
      item_id: "item-1",
      status: "ready",
      language: "L0166",
      name: "Fixture",
    },
    meta: {
      graffiticode: {
        data: { data: { type: "spreadsheet" }, errors: [] },
        view_url: "https://app.graffiticode.org/form/item-1",
      },
    },
  });
  assert.equal(merged.item_id, "item-1");
  assert.deepEqual(merged.data, { data: { type: "spreadsheet" }, errors: [] });
  assert.equal(merged.view_url, "https://app.graffiticode.org/form/item-1");
});
