/**
 * The native language bundles are INTERACTIVE, not pictures.
 *
 * Every `Form` in the language family is controlled: it holds the candidate's answer
 * in `state.data` and calls `state.apply(action)` to change it. Whether the widget
 * re-renders after that call is the whole difference between an assessment that
 * scores and one that looks right and does nothing — and nothing else in this repo
 * can tell those apart. The bundle builds, mounts, draws its options, reports a
 * non-empty height, and passes `renderer.ts`'s empty-mount check either way.
 *
 * That is exactly how it shipped: `mount()` built a plain object whose `apply`
 * reassigned a closure variable, so React never heard about the click. In the widget
 * an L0180 item rendered its options and then refused to select one; in
 * app.graffiticode.org the same component scored, because there `apply` is a
 * `useReducer` dispatch (see l0000-view's `View`).
 *
 * L0180 is the case under test because it computes its own result in the browser —
 * it ships `scoreChoice`, so a correct click must produce "Correct — 1 / 1 point"
 * with no network at all, which is what the widget's CSP (no `connectDomains`)
 * allows. A language whose feedback is computed by an upstream `/compile` round trip
 * cannot be asserted this way and is not covered here.
 *
 * The fixture is the verbatim `data` envelope from a real generated item
 * (`LFVcuydvvsorA6SUC7RJ`), envelope and all, so it also pins `unwrapEnvelope`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const L0180_DATA = {
  data: {
    interaction: {
      type: "choice",
      prompt: "Which gas do plants absorb from the air during photosynthesis?",
      minChoices: 0,
      maxChoices: 1,
      shuffle: false,
      options: [
        { id: "A", text: "Oxygen" },
        { id: "B", text: "Carbon dioxide" },
        { id: "C", text: "Nitrogen" },
        { id: "D", text: "Hydrogen" },
      ],
    },
    validation: {
      responseProcessing: "map_response",
      cardinality: "single",
      baseType: "identifier",
      points: 1,
      mapping: { B: { correct: true, points: 1 } },
      feedback: {
        A: "Oxygen is released by plants during photosynthesis, not absorbed.",
        C: "Nitrogen is not used by plants during photosynthesis.",
        D: "Hydrogen is not absorbed from the air by plants during photosynthesis.",
      },
    },
  },
  errors: [],
};

/** Install a DOM, mount the built bundle, and hand back a click-and-read harness. */
async function mountL0180() {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
    url: "https://mcp.graffiticode.org/",
    pretendToBeVisual: true,
  });
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  // `navigator` is a getter-only global on modern Node, so it needs defineProperty.
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  g.HTMLElement = dom.window.HTMLElement;
  g.Element = dom.window.Element;
  g.Node = dom.window.Node;
  g.MutationObserver = dom.window.MutationObserver;
  g.requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
  g.cancelAnimationFrame = (id: number) => clearTimeout(id);

  // The built artifact, not the source: this asserts what the host actually loads.
  const mod = (await import("../dist/widget/lang/L0180.mjs")) as {
    styles: string;
    mount: (el: unknown, data: unknown) => void;
  };
  const root = dom.window.document.getElementById("root")!;
  mod.mount(root, L0180_DATA);
  // React 18 renders asynchronously; a macrotask is enough to flush it.
  const settle = () => new Promise((r) => setTimeout(r, 50));
  await settle();

  return {
    text: () => root.textContent ?? "",
    async choose(id: string) {
      const input = root.querySelector(`input[value="${id}"]`);
      assert.ok(input, `no option input for ${id}`);
      input.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await settle();
    },
  };
}

test("L0180 mounts, and selecting an option scores it", async () => {
  const item = await mountL0180();
  assert.match(item.text(), /Which gas do plants absorb/);
  assert.doesNotMatch(item.text(), /point/, "must not score before anything is chosen");

  await item.choose("B");
  assert.match(item.text(), /Correct — 1 \/ 1 point/);
});

test("L0180 shows the distractor rationale for a wrong answer", async () => {
  const item = await mountL0180();
  await item.choose("A");
  assert.match(item.text(), /Not quite — 0 \/ 1 point/);
  assert.match(item.text(), /Oxygen is released by plants/);
});
