// Excerpts from NUDGEMENTS.md. Findings are recorded responses, never generated in the browser.
export const examples = {
  commit: {
    title: "Name what actually changed.",
    source: "ansi-regex",
    url: "https://github.com/chalk/ansi-regex/commit/f1bf1f05234e43ad241cf0408cb03c39e147218c",
    before: "Improve performance",
    after: "fix: stop unterminated OSC strings consuming later escapes",
    finding: "The subject is generic. Name what actually changed.",
    evaluator: "Commit evaluator",
  },
  code: {
    title: "A small comment. A lot less guesswork.",
    source: "indent-string",
    url: "https://github.com/sindresorhus/indent-string/blob/7e6c356c4a8425b06efb5c031479304ee0bd67ea/index.js",
    before: String.raw`const regex = includeEmptyLines ? /^/gm : /^(?!\s*$)/gm;`,
    after: String.raw`// Anchor each line; unless requested, skip lines containing only whitespace.
const regex = includeEmptyLines ? /^/gm : /^(?!\s*$)/gm;`,
    finding: "Give obscure literals or patterns meaningful names and explain their format, units or rationale.",
    evaluator: "Code evaluator",
  },
  copy: {
    title: "Help the person, not the protocol.",
    source: "Excalidraw",
    url: "https://github.com/excalidraw/excalidraw/blob/5a406e51875157bece389b9bc92d41ff241d5f3d/packages/excalidraw/locales/en.json",
    before: "Encryption key must be of 22 characters. Live collaboration is disabled.",
    after: "This collaboration link is invalid. Ask the sender for a new link.",
    finding: "Use plainer words; this reads like jargon.",
    evaluator: "UI copy evaluator",
  },
  test: {
    title: "Test the promise, not the machine’s speed.",
    source: "Bun",
    url: "https://github.com/oven-sh/bun/blob/9f70da074192e55c3ec68aef7fd982e6b4b0284b/test/js/bun/util/sleepSync.test.ts#L4-L10",
    before: `const start = performance.now();
sleepSync(50);
const end = performance.now();
expect(end - start).toBeGreaterThanOrEqual(5);
expect(end - start).toBeLessThan(1000);`,
    after: `const durationMs = 50;
const start = performance.now();
sleepSync(durationMs);
expect(performance.now() - start)
  .toBeGreaterThanOrEqual(durationMs);`,
    finding: "Could fail at random (timing, clock, or test order).",
    evaluator: "Test evaluator",
  },
};
