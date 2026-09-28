import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { SourceRule } from "./source-rules-lib";
import { isNonTestSrcPath, matchProblems, violationsIn } from "./source-rules-lib";

const isPublicMarkupPath = (path: string) => /^public\/.*\.(html|svg)$/.test(path);
const isPublicStylesCssPath = (path: string) => /^public\/styles\/[^/]+\.css$/.test(path);

const noInlineStyles: SourceRule = {
  name: "no inline styles",
  appliesTo: (path) => isNonTestSrcPath(path) || isPublicMarkupPath(path),
  findProblems: (source) => [
    ...matchProblems(source, /\bstyle\s*=/, "inline style attribute"),
    ...matchProblems(source, /<style[\s>]/i, "style element"),
  ],
};

type Course = { id: string; name: string };

function loadCourses(): Course[] {
  if (!existsSync("courses")) return [];
  return readdirSync("courses")
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const id = file.slice(0, -".json".length);
      const { name } = JSON.parse(readFileSync(join("courses", file), "utf8")) as { name: string };
      return { id, name };
    });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function idPattern(id: string): RegExp {
  const safe = escapeRegExp(id);
  return new RegExp(`["'\`]${safe}["'\`]|\\bgame-${safe}\\b`, "g");
}

function makeCourseNeutralRule(courses: Course[]): SourceRule {
  return {
    name: "course-neutral code",
    appliesTo: (path) => isNonTestSrcPath(path) || isPublicStylesCssPath(path),
    findProblems: (source) =>
      courses.flatMap((course) => [
        ...matchProblems(source, idPattern(course.id), `id "${course.id}"`),
        ...matchProblems(source, new RegExp(escapeRegExp(course.name), "gi"), `name "${course.name}"`),
      ]),
  };
}

const RULES: SourceRule[] = [noInlineStyles, makeCourseNeutralRule(loadCourses())];

const CASES: Array<{ rule: SourceRule; bad: string[]; good: string[] }> = [
  {
    rule: noInlineStyles,
    bad: ['<p style="color: red">', '<div style={{ color: "red" }}>', "<style>p{}</style>"],
    good: ['<p class="note">'],
  },
  {
    rule: makeCourseNeutralRule([{ id: "wheel", name: "Wheel Throwing" }]),
    bad: ['if (course.id === "wheel")', ".course-wheel { }", 'title = "Wheel Throwing"'],
    good: ["// no wheel values here", "course.id === id"],
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

it("keeps the project free of problems from every code rule", () => {
  const violations = violationsIn(RULES);
  expect(violations, violations.join("\n")).toEqual([]);
});
