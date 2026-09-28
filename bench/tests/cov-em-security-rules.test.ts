import { extname } from "node:path";
import { expect, it } from "vitest";
import type { SourceRule } from "./source-rules-lib";
import { findAll, isNonTestSrcPath, lineAt, matchProblems, violationsIn } from "./source-rules-lib";

const noRawHtml: SourceRule = {
  name: "no raw HTML",
  appliesTo: isNonTestSrcPath,
  findProblems: (source) => [
    ...matchProblems(source, /dangerouslySetInnerHTML/, "dangerouslySetInnerHTML"),
    ...matchProblems(source, /\braw\(/, "raw("),
    ...matchProblems(source, /from\s+["']hono\/html["']/, 'import from "hono/html"'),
  ],
};

// Not a full parser: just two shapes for "one static string literal then a close paren", tried
// in turn, so a call is accepted only when nothing but that shape (plus a formatter's optional
// trailing comma) follows the open paren.
const SINGLE_STATIC_ARG = [
  /^\s*(["'])(?:(?!\1)[^\\]|\\.)*\1\s*,?\s*\)/,
  /^\s*`(?:[^`\\$]|\\.|\$(?!\{))*`\s*,?\s*\)/,
];

function isSingleStaticStringCall(source: string, afterOpenParen: number): boolean {
  const rest = source.slice(afterOpenParen);
  return SINGLE_STATIC_ARG.some((pattern) => pattern.test(rest));
}

const staticSqlOnly: SourceRule = {
  name: "static SQL only",
  appliesTo: isNonTestSrcPath,
  findProblems: (source) => [
    ...findAll(source, /\.prepare\(/)
      .filter((m) => !isSingleStaticStringCall(source, (m.index ?? 0) + (m[0] ?? "").length))
      .map((m) => `line ${lineAt(source, m.index ?? 0)}: .prepare needs a static literal`),
    ...matchProblems(source, /\b(?:db|DB|database)\.exec\(/, "exec( on a database is forbidden"),
  ],
};

const INVISIBLE_RANGES: Array<[number, number]> = [
  [0x0000, 0x0008],
  [0x000b, 0x000b],
  [0x000c, 0x000c],
  [0x000e, 0x001f],
  [0x007f, 0x007f],
  [0x00a0, 0x00a0],
  [0x200b, 0x200f],
  [0x2028, 0x202f],
  [0x2060, 0x2069],
  [0xfeff, 0xfeff],
];
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".css",
  ".json",
  ".jsonc",
  ".md",
  ".sql",
  ".html",
  ".svg",
]);

// Built from the code points at runtime, not typed as literal \u escapes, so this file never
// contains a backslash-u sequence a JSON-decoding step could mistake for the real character.
function rangeToClass([low, high]: [number, number]): string {
  return `${String.fromCodePoint(low)}-${String.fromCodePoint(high)}`;
}
const INVISIBLE_RE = new RegExp(`[${INVISIBLE_RANGES.map(rangeToClass).join("")}]`, "u");

const noInvisibleCharacters: SourceRule = {
  name: "no invisible characters",
  appliesTo: (path) => path === "bootstrap" || TEXT_EXTENSIONS.has(extname(path)),
  findProblems: (source) => {
    const lines = new Set(findAll(source, INVISIBLE_RE).map((m) => lineAt(source, m.index ?? 0)));
    return [...lines].sort((a, b) => a - b).map(String);
  },
};

const RULES: SourceRule[] = [noRawHtml, staticSqlOnly, noInvisibleCharacters];

// Built from a character code, not typed as a literal escape, so this file never contains the
// two-character sequence that a JSON-decoding step could mistake for a real Unicode escape.
const backslash = String.fromCharCode(92);

const CASES: Array<{ rule: SourceRule; bad: string[]; good: string[] }> = [
  {
    rule: noRawHtml,
    bad: [
      'raw("<b>")',
      'import { html } from "hono/html"',
      "return <div dangerouslySetInnerHTML={{ __html: x }} />;",
    ],
    good: ["<b>{name}</b>"],
  },
  {
    rule: staticSqlOnly,
    bad: [
      `db.prepare(\`SELECT * FROM workshops WHERE id = '\${id}'\`)`,
      'db.prepare("SELECT " + columns)',
      "db.prepare(sql)",
      'db.exec("DROP TABLE workshops")',
      "c.env.DB.exec(sql)",
      `db.prepare(\`SELECT \${x}\`,\n)`,
      'db.prepare("A",\n "B")',
    ],
    good: [
      'db.prepare("SELECT 1")',
      "db.prepare(`\n  SELECT *\n  WHERE id = ?1\n`).bind(id)",
      "YEAR_MONTH.exec(input)",
      "/x/.exec(text)",
      'db\n  .prepare(\n    "SELECT 1",\n  )',
      "db.prepare(`\n  SELECT *\n  WHERE id = ?1\n`,\n).bind(id)",
    ],
  },
  {
    rule: noInvisibleCharacters,
    bad: [
      `a${String.fromCodePoint(0x202e)}b`,
      `a${String.fromCodePoint(0x00a0)}b`,
      `a${String.fromCodePoint(0)}b`,
      `a${String.fromCodePoint(0xfeff)}b`,
      `a${String.fromCodePoint(0x2066)}b`,
    ],
    good: [`${backslash}u202e`],
  },
];

it.each(CASES)("$rule.name catches its bad samples", ({ rule, bad }) => {
  for (const sample of bad) {
    expect(rule.findProblems(sample), sample).not.toEqual([]);
  }
});

it.each(CASES)("$rule.name leaves its good samples alone", ({ rule, good }) => {
  for (const sample of good) {
    expect(rule.findProblems(sample), sample).toEqual([]);
  }
});

it("keeps the project free of problems from every security rule", () => {
  const violations = violationsIn(RULES);
  expect(violations, violations.join("\n")).toEqual([]);
});
