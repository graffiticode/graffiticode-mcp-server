import assert from "node:assert/strict";
import test from "node:test";
import { formatToolResult } from "../src/tool-result.js";

test("widget hydration stays out of structuredContent and chat text", () => {
  const response = formatToolResult({
    item_id: "item-1",
    status: "ready",
    language: "L0166",
    name: "Example",
    summary: "Example is ready — https://app.graffiticode.org/form/item-1",
    _meta: {
      graffiticode: {
        src: "secret language source",
        data: { answer: 42 },
        view_url: "https://app.graffiticode.org/form/item-1",
      },
    },
  });

  assert.deepEqual(response.structuredContent, {
    item_id: "item-1",
    status: "ready",
    language: "L0166",
    name: "Example",
  });
  const text = ((response.content as Array<{ text: string }>)[0]).text;
  assert.doesNotMatch(text, /secret language source|"answer"/);
  assert.equal((response._meta as Record<string, unknown>).graffiticode !== undefined, true);
});

test("omitMeta drops the hydration payload for widget-less (OpenAI) clients", () => {
  const result = {
    item_id: "item-1",
    status: "ready",
    language: "L0166",
    name: "Example",
    summary: "Ready: https://app.graffiticode.org/form/item-1",
    _meta: { graffiticode: { src: "secret language source", data: { answer: 42 } } },
  };

  const withWidget = formatToolResult(result);
  assert.equal((withWidget._meta as Record<string, unknown>).graffiticode !== undefined, true);

  const noWidget = formatToolResult(result, { omitMeta: true });
  assert.equal(noWidget._meta, undefined);
  // structuredContent + chat text stay identical and compact either way.
  assert.deepEqual(noWidget.structuredContent, withWidget.structuredContent);
  assert.doesNotMatch(JSON.stringify(noWidget), /secret language source|"answer"/);
});

test("render results cannot regress the removed access-token URL", () => {
  const response = formatToolResult({
    item_id: "item-1",
    status: "ready",
    language: "L0173",
    name: null,
    summary: "Ready: https://app.graffiticode.org/form/item-1",
    _meta: {
      graffiticode: {
        data: { data: { type: "chart" }, errors: [] },
        claim_url: "https://console.graffiticode.org/claim?token=allowed-claim-capability",
      },
    },
  });
  const serialized = JSON.stringify(response);
  assert.doesNotMatch(serialized, /form_url|access_token|authorization/i);
  assert.match(serialized, /claim\?token=allowed-claim-capability/);
});
