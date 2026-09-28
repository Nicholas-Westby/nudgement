import { relative } from "node:path";
import stylelint from "stylelint";
import { expect, it } from "vitest";

const CONFIG_FILE = ".stylelintrc.json";

const BAD_SAMPLES = [
  ".a { color: #fff; }",
  ".a { color: red; }",
  ".a { color: rgb(0 0 0); }",
  ".a { font-family: Georgia, serif; }",
  ".a { padding: 12px; }",
  ".a { font-size: 18px; }",
  ".a { border: 1px solid #000; }",
  ".a { margin: 0 8px; }",
  ".a { color: var(--ink) !important; }",
];

const GOOD_SAMPLE =
  ".a { color: var(--ink); padding: var(--space-2) 0; border: 1px solid var(--rule); " +
  "background: color-mix(in srgb, var(--course-color) 12%, var(--paper)); margin: 0 auto; }";

const TOKENS_SAMPLE =
  ':root { --ink: #1d2b28; --font-body: "Atkinson Hyperlegible Next", sans-serif; }';

async function lintSample(code: string, codeFilename: string) {
  const result = await stylelint.lint({ code, codeFilename, configFile: CONFIG_FILE });
  return result.results[0]?.warnings ?? [];
}

it.each(BAD_SAMPLES)("flags a wheel CSS value: %s", async (code) => {
  const warnings = await lintSample(code, "public/styles/site.css");
  expect(warnings, code).not.toEqual([]);
});

it("allows design tokens, CSS-wide keywords and ignored functions", async () => {
  const warnings = await lintSample(GOOD_SAMPLE, "public/styles/site.css");
  expect(warnings, GOOD_SAMPLE).toEqual([]);
});

it("lets tokens.css itself define the raw values", async () => {
  const warnings = await lintSample(TOKENS_SAMPLE, "public/styles/tokens.css");
  expect(warnings, TOKENS_SAMPLE).toEqual([]);
});

it("keeps every project stylesheet free of wheel CSS values", async () => {
  const result = await stylelint.lint({
    files: "public/styles/**/*.css",
    configFile: CONFIG_FILE,
    allowEmptyInput: true,
  });
  const messages = result.results.flatMap((file) =>
    file.warnings.map(
      (w) => `${relative(process.cwd(), file.source ?? "unknown")}:${w.line} ${w.rule} ${w.text}`,
    ),
  );

  expect(messages, messages.join("\n")).toEqual([]);
});
