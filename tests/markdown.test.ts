import { describe, expect, test } from "bun:test";
import { analyzeMarkdown, readmeLint, slug } from "../src/markdown";

const README = `# tidefetch

Downloads tide tables for a harbour and prints the next high water.

[![CI](https://github.com/x/y/actions/workflows/ci.yml/badge.svg)](https://github.com/x/y/actions)

## Install

\`\`\`sh
bun install
bun run build
\`\`\`

## Usage

Run \`bun src/cli.ts <harbour>\`. See [the config docs](docs/config.md) and [options](#options).

### Options

- \`--days <n>\`: how many days to print
- \`--metres\`: heights in metres, not feet

## License

MIT
`;

describe("analyzeMarkdown", () => {
  const md = analyzeMarkdown(README);

  test("finds the title and splits sections at level-two headings", () => {
    expect(md.title).toBe("tidefetch");
    expect(md.sections.map((section) => section.heading)).toEqual(["tidefetch", "Install", "Usage", "License"]);
    expect(md.sections[2].text).toContain("### Options");
    expect(md.sections[1].startLine).toBe(7);
  });

  test("collects links, images and code blocks outside code", () => {
    expect(md.links.map((link) => link.target)).toEqual([
      "https://github.com/x/y/actions/workflows/ci.yml/badge.svg",
      "https://github.com/x/y/actions",
      "docs/config.md",
      "#options",
    ]);
    expect(md.codeBlocks).toHaveLength(1);
    expect(md.codeBlocks[0].text).toContain("bun run build");
  });

  test("counts facts about the prose", () => {
    expect(md.facts.badges).toBe(1);
    expect(md.facts.listItems).toBe(2);
    expect(md.facts.headings).toEqual({ h1: 1, h2: 3, h3: 1 });
    expect(md.facts.words).toBeGreaterThan(25);
    expect(md.facts.words).toBeLessThan(60);
    expect(md.facts.hasToc).toBe(false);
  });

  test("ignores headings and links inside code blocks", () => {
    const inCode = analyzeMarkdown("# a\n\n```md\n## not a heading\n[x](nowhere.md)\n```\n");
    expect(inCode.sections.map((section) => section.heading)).toEqual(["a"]);
    expect(inCode.links).toEqual([]);
  });
});

test("slugs headings the way GitHub does", () => {
  expect(slug("Getting Started")).toBe("getting-started");
  expect(slug("What's `bun run`?")).toBe("whats-bun-run");
  expect(slug("🚀 Features")).toBe("-features");
});

describe("readmeLint", () => {
  const lint = (text: string, files: string[] = [], scripts?: string[]) =>
    readmeLint(analyzeMarkdown(text), { exists: (path) => files.includes(path), scripts: scripts && new Set(scripts) });
  const rules = (text: string, files: string[] = [], scripts?: string[]) => lint(text, files, scripts).map((issue) => issue.source);

  test("a clean README has no findings", () => {
    expect(rules(README, ["docs/config.md", "src/cli.ts"], ["build"])).toEqual([]);
  });

  test("flags broken relative links and anchors", () => {
    const found = rules(README, [], ["build"]);
    expect(found).toContain("lint:broken-link");
    expect(rules("# a\n\nSee [x](#nowhere).\n")).toContain("lint:broken-anchor");
  });

  test("flags a run script that package.json does not have", () => {
    expect(rules(README, ["docs/config.md", "src/cli.ts"], ["test"])).toContain("lint:missing-script");
  });

  test("flags a command that runs a file that does not exist", () => {
    expect(rules(README, ["docs/config.md"], ["build"])).toContain("lint:missing-file");
  });

  test("flags heading structure problems", () => {
    expect(rules("# a\n\n### skipped\n\ntext\n")).toContain("lint:heading-skip");
    expect(rules("# a\n\ntext\n\n# b\n\ntext\n")).toContain("lint:multiple-h1");
    expect(rules("# a\n\n## Empty\n\n## Next\n\ntext\n")).toContain("lint:empty-section");
    expect(rules("# a\n\n## 🚀 Features\n\ntext\n")).toContain("lint:heading-emoji");
  });

  test("flags a table of contents in a short README", () => {
    const toc = "# a\n\n## Contents\n\n- [One](#one)\n- [Two](#two)\n- [Three](#three)\n\n## One\n\nx\n\n## Two\n\ny\n\n## Three\n\nz\n";
    expect(rules(toc)).toContain("lint:short-toc");
  });

  test("flags AI wording", () => {
    expect(rules("# a\n\nA powerful, blazing-fast tool that seamlessly tracks your hives.\n")).toContain("lint:ai-words");
  });
});

test("skips a YAML front matter block at the top", () => {
  const md = analyzeMarkdown("---\nname: using-it\ndescription: Use when committing.\n---\n\n# Using it\n\nRun the check.\n");
  expect(md.sections.map((section) => section.heading)).toEqual(["Using it"]);
  expect(md.headings.map((heading) => heading.text)).toEqual(["Using it"]);
  expect(md.facts.words).toBe(5);
});
