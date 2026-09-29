import { reviewClarity } from "./clarity";
import { noul, score } from "./jev";
import type { Issue } from "./message";
import { clip, type JevStats, jevSource, reader, startRun, touches } from "./run";
import { declaresSerialOrder, type FoundTest, findTests, testLanguageOf } from "./test-parse";
import { TEST_FILE_QUESTIONS, TEST_QUESTIONS } from "./test-questions";
import { judgeTest, T } from "./test-rules";

const SETUP_BUDGET = 3_000;

const TEST_BUDGET = 12_000;

const FILE_BUDGET = 40_000;

const MAX_TESTS = 80;

export interface TestResult {
  name: string;
  describe: string[];
  startLine: number;
  endLine: number;
  issues: Issue[];
  readings: Record<string, unknown>;
}

export interface TestFileEvaluation {
  kind: "tests";
  runId: string;
  version: string;
  repo?: string;
  ref?: string;
  path: string;
  framework: string;
  verdict: "pass" | "fail";
  tests: TestResult[];
  issues: Issue[];
  readings: Record<string, unknown>;
  jev: JevStats;
}

// Only real import lines count: a test's fixtures may quote another framework's import.
function frameworkOf(path: string, text: string): string {
  if (testLanguageOf(path) === "swift") return /^import\s+Testing\b/m.test(text) ? "swift-testing" : "xctest";
  const imported = /^import[^\n]*from ["'](@playwright\/test|vitest|bun:test)["']/m.exec(text)?.[1];
  if (imported === "@playwright/test") return "playwright";
  if (imported === "bun:test") return "bun";
  return imported ?? "jest-style";
}

// Imports and helpers at the top of the file, so each test is read in context.
function setupOf(text: string, tests: FoundTest[]): string {
  const firstLine = tests[0]?.startLine ?? 1;
  const head = text
    .split("\n")
    .slice(0, Math.max(0, firstLine - 1))
    .join("\n");
  return clip(head, SETUP_BUDGET, "\n[... cut ...]");
}

export function testFileState(path: string, text: string, framework = frameworkOf(path, text)) {
  return { file: path, framework, code: clip(text, FILE_BUDGET, "\n[... cut ...]") };
}

export function nameForJev(test: FoundTest): string {
  if (test.language === "swift" && /^\w+$/.test(test.name)) {
    return test.name
      .replace(/^test_?/, "")
      .replace(/_/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z]{2,})/g, "$1 $2")
      .replace(/\b[A-Z][a-z]/g, (word) => word.toLowerCase())
      .trim();
  }
  // A table-driven name such as "rejects %s" reads as a broken sentence; show the placeholders as values.
  return isTable(test) ? test.name.replace(/%[sdifjop#%]|\$\w+/g, "<value>") : test.name;
}

export const isTable = (test: FoundTest) => test.modifiers.includes("each") || test.modifiers.includes("for");

/** Combine assertion facts, Jev's behavior checks and code clarity; touched reviews omit whole-file quality claims. */
export async function evaluateTests(
  input: { path: string; text: string; repo?: string; ref?: string },
  options: { tag?: string; touched?: Set<number> } = {},
): Promise<TestFileEvaluation> {
  const { runId, version, stats, issues, track, finish } = startRun();
  const framework = frameworkOf(input.path, input.text);
  const swift = testLanguageOf(input.path) === "swift";
  const all = findTests(input.text, input.path);
  const tests = all.filter((test) => !options.touched || touches(options.touched, test)).slice(0, MAX_TESTS);
  const setup = setupOf(input.text, all);
  const serial = declaresSerialOrder(input.text);
  const fileUsesFakeClock = /useFakeTimers|setSystemTime|clock\.install|\.clock\./.test(input.text);

  const [clarity, whole, ...perTest] = await Promise.all([
    reviewClarity(input, track, options),
    options.touched
      ? Promise.resolve(undefined)
      : track(`tests:${input.path}`, testFileState(input.path, input.text, framework), TEST_FILE_QUESTIONS),
    ...tests.map((test) =>
      test.modifiers.includes("todo")
        ? Promise.resolve(undefined)
        : track(
            `test:${input.path}:${test.startLine}`,
            {
              file: input.path,
              framework,
              setup,
              test: {
                name: nameForJev(test),
                describe: test.describe,
                code: test.code.slice(0, TEST_BUDGET),
              },
            },
            TEST_QUESTIONS,
          ),
    ),
  ]);

  const file = {
    fakeClock: fileUsesFakeClock,
    endToEnd: framework === "playwright" || /\bXCUIApplication\b/.test(input.text),
    serial: !swift && serial,
  };
  const results = tests.map((test, index) => judgeTest(test, perTest[index], file));
  const readings: Record<string, unknown> = { clarity: clarity.readings };
  issues.push(...clarity.issues);
  if (whole) {
    // Shared servers and fixtures belong to the file; repeating the warning marked individual tests unfairly.
    const order = reader(whole, readings)("order_dependent");
    if (order >= T.orderDependent && !serial)
      issues.push({
        severity: "warn",
        part: "order",
        message: "Tests depend on state other tests leave behind. Give each its own setup.",
        source: jevSource("order_dependent", order),
      });
    const edge = noul(whole, "edge_cases");
    const duplicated = noul(whole, "duplicated_setup");
    Object.assign(readings, { edge_cases: edge, duplicated_setup: duplicated, overall: score(whole, "overall").score });
    if (edge < T.edgeCases)
      issues.push({
        severity: "warn",
        part: "coverage",
        message: "Tests only the happy path. Add failures and limits.",
        source: jevSource("edge_cases", edge),
      });
    if (duplicated > T.duplicatedSetup)
      issues.push({
        severity: "warn",
        part: "setup",
        message: "Repeats setup that belongs in a helper.",
        source: jevSource("duplicated_setup", duplicated),
      });
  }
  if (!all.length)
    issues.push({
      severity: "warn",
      part: "tests",
      message: swift ? "No @Test functions or XCTest test methods found." : "No test() or it() calls found.",
      source: "fact:no-tests",
    });

  const errors = [...issues, ...results.flatMap((result) => result.issues)].some((issue) => issue.severity === "error");
  const evaluation: TestFileEvaluation = {
    kind: "tests",
    runId,
    version,
    repo: input.repo,
    ref: input.ref,
    path: input.path,
    framework,
    verdict: errors ? "fail" : "pass",
    tests: results,
    issues,
    readings,
    jev: stats,
  };
  return finish(evaluation, { tag: options.tag });
}

export { TEST_FILE_QUESTIONS } from "./test-questions";
export { judgeTest, TEST_THRESHOLDS } from "./test-rules";
