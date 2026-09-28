/**
 * Judges the tests in one test file: does each assert behaviour someone would
 * notice, with exact values, without testing its own mocks, and would it fail
 * if the code under test broke? Code counts assertions, weak matchers, mocks,
 * sleeps and CSS selectors; Jev judges each test in its own request, and the
 * file once as a whole. Thresholds are in TEST_THRESHOLDS for tuning against
 * bench/tests.
 */

import { choice, noul, score, type Answers, type Question } from "./jev";
import { clip, jevSource, reader, startRun, touches, type JevStats } from "./run";
import type { Issue } from "./message";
import { declaresSerialOrder, findTests, testFacts, testLanguageOf, type FoundTest } from "./test-parse";

// Benchmarked 2026-09-26 on 168 labelled tests in 24 files (bench/tests).
// plain_name separates bad names cleanly; name_matches misfires on good tests,
// so only a very low reading of it counts.
export const TEST_THRESHOLDS = {
  implementationDetail: 0.35,
  specificWarn: 0.19,
  overMocked: 0.42,
  vacuousError: 0.75,
  vacuousWarn: 0.6,
  plainName: 0.75,
  plainNameTable: 0.5,
  nameMatches: 0.15,
  oneBehaviour: 0.55,
  flaky: 0.65,
  // End-to-end tests must use the real clock and network, so they read higher: flaky
  // ones in the bench read 0.80 and up, robust ones in real use 0.76 at most.
  flakyEndToEnd: 0.78,
  orderDependent: 0.6,
  // For the file as a whole: below edgeCases it tests only the happy path. On 54
  // labelled files, happy-path-only ones read 0.14 at most, the rest 0.20 and up.
  edgeCases: 0.17,
  duplicatedSetup: 0.7,
};

const T = TEST_THRESHOLDS;
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
  const head = text.split("\n").slice(0, Math.max(0, firstLine - 1)).join("\n");
  return clip(head, SETUP_BUDGET, "\n[... cut ...]");
}

const TEST_QUESTIONS: Record<string, Question> = {
  user_visible: {
    type: "noul",
    instructions: {
      question: "Does `test.code` check behaviour someone outside the code would notice, rather than implementation details?",
      behaviour: "a return value, an HTTP response, what appears on the page or screen, what is stored, or what is sent to an outside service such as an API, a database, or a model",
      implementation_details: "which internal helper ran, private state, or how many times the code's own functions were called",
    },
  },
  specific: {
    type: "noul",
    instructions: "Do the assertions in `test.code` check exact expected values, rather than only that something is truthy, defined or not nil, non-empty, of some type, or matches a snapshot?",
  },
  over_mocked: {
    type: "noul",
    instructions: {
      question: "Does `test.code` mock so much that it mostly checks its own mocks rather than real code?",
      examples_of_yes: ["it asserts on a value its own mock returned", "it mocks the code's collaborators and asserts only that one of them was or was not called"],
      examples_of_no: ["only the outside services, such as the network or a model, are stubs, and it asserts on the result or the messages the real code produced"],
    },
  },
  vacuous: {
    type: "noul",
    instructions: {
      question: "Would `test.code` still pass even if the code it exercises returned wrong results?",
      examples_of_yes: [
        "it asserts only on values the test set up itself, such as a constant",
        "it asserts only on a mock it configured",
        "its assertions cannot fail, such as checking that an object that always exists is truthy or not nil",
      ],
      examples_of_no: ["it asserts on the status, body, or return value that the real code produces", "it asserts on what the real code sent to a fake or spy that only records it, such as a log line or a saved row"],
    },
  },
  plain_name: {
    type: "noul",
    instructions: "Is `test.name` a plain sentence that says what behaviour is expected, the way a person would describe it, rather than a label such as 'test1', 'works', 'should work', or 'handles edge case'?",
  },
  name_matches: {
    type: "noul",
    instructions: "Does `test.code` check what `test.name` says it checks?",
  },
  one_behaviour: {
    type: "noul",
    instructions: "Does `test.code` check one behaviour, rather than several unrelated ones?",
  },
  flaky: {
    type: "noul",
    instructions: "Could `test.code` fail at random because it depends on sleeps, timing, the real clock or date, network, or other tests running first?",
  },
  action: {
    type: "choice",
    instructions: "What should a careful reviewer ask for with `test`?",
    criteria: {
      keep: "Keep it as it is",
      tighten: "Keep it but assert exact values",
      rewrite: "Rewrite it to test behaviour through the public interface",
      delete: "Delete it: it cannot fail or tests nothing real",
    },
  },
};

export const TEST_FILE_QUESTIONS: Record<string, Question> = {
  order_dependent: {
    type: "noul",
    instructions: "Do tests in `code` depend on running in a particular order, or on state that earlier tests leave behind, such as a shared variable or database rows one test creates for the next?",
  },
  edge_cases: {
    type: "noul",
    instructions: "Besides the happy path, does `code` test failures and edge cases, such as invalid input, limits, and error responses?",
  },
  duplicated_setup: {
    type: "noul",
    instructions: "Does `code` repeat the same setup in many tests where a shared helper or fixture would be clearer?",
  },
  overall: {
    type: "score",
    instructions: "How good is `code` as a test file?",
    criteria: [
      "Poor: tests that cannot fail, test internals, or assert almost nothing",
      "Needs work: mostly useful, with weak assertions, over-mocking, or unclear names",
      "Good: behaviour-focused tests with exact assertions and plain names",
      "Excellent: exactly what a careful senior engineer would write",
    ],
  },
};

/** What Jev reads to judge a test file as a whole. */
export function testFileState(path: string, text: string, framework = frameworkOf(path, text)) {
  return { file: path, framework, code: clip(text, FILE_BUDGET, "\n[... cut ...]") };
}

/** The test's name as Jev reads it: a Swift function name as words, a table's placeholders as values. */
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

const isTable = (test: FoundTest) => test.modifiers.includes("each") || test.modifiers.includes("for");

export async function evaluateTests(
  input: { path: string; text: string; repo?: string; ref?: string },
  options: { tag?: string; touched?: Set<number> } = {}
): Promise<TestFileEvaluation> {
  const { runId, version, stats, issues, track, finish } = startRun();
  const framework = frameworkOf(input.path, input.text);
  const swift = testLanguageOf(input.path) === "swift";
  const all = findTests(input.text, input.path);
  const tests = all.filter((test) => !options.touched || touches(options.touched, test)).slice(0, MAX_TESTS);
  const setup = setupOf(input.text, all);
  const serial = declaresSerialOrder(input.text);
  const fileUsesFakeClock = /useFakeTimers|setSystemTime|clock\.install|\.clock\./.test(input.text);

  const [whole, ...perTest] = await Promise.all([
    options.touched ? Promise.resolve(undefined) : track(`tests:${input.path}`, testFileState(input.path, input.text, framework), TEST_FILE_QUESTIONS),
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
            TEST_QUESTIONS
          )
    ),
  ]);

  const file = { fakeClock: fileUsesFakeClock, endToEnd: framework === "playwright" || /\bXCUIApplication\b/.test(input.text), serial: !swift && serial };
  const results = tests.map((test, index) => judgeTest(test, perTest[index], file));
  const readings: Record<string, unknown> = {};
  if (whole) {
    // Reported for the file: copying it onto each test flagged good tests that
    // share a server or a fixture on purpose.
    const order = reader(whole, readings)("order_dependent");
    if (order >= T.orderDependent && !serial) issues.push({ severity: "warn", part: "order", message: "Tests depend on state other tests leave behind. Give each its own setup.", source: jevSource("order_dependent", order) });
    const edge = noul(whole, "edge_cases");
    const duplicated = noul(whole, "duplicated_setup");
    Object.assign(readings, { edge_cases: edge, duplicated_setup: duplicated, overall: score(whole, "overall").score });
    if (edge < T.edgeCases) issues.push({ severity: "warn", part: "coverage", message: "Tests only the happy path. Add failures and limits.", source: jevSource("edge_cases", edge) });
    if (duplicated > T.duplicatedSetup) issues.push({ severity: "warn", part: "setup", message: "Repeats setup that belongs in a helper.", source: jevSource("duplicated_setup", duplicated) });
  }
  if (!all.length) issues.push({ severity: "warn", part: "tests", message: swift ? "No @Test functions or XCTest test methods found." : "No test() or it() calls found.", source: "fact:no-tests" });

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

export function judgeTest(test: FoundTest, answers: Answers | undefined, file: { fakeClock: boolean; endToEnd: boolean; serial: boolean }): TestResult {
  const result: TestResult = { name: test.name, describe: test.describe, startLine: test.startLine, endLine: test.endLine, issues: [], readings: {} };
  const add = (severity: Issue["severity"], message: string, source: string) => result.issues.push({ severity, part: test.name, message, source });
  const facts = testFacts(test.code, test.language);
  result.readings.facts = facts;

  // Exact findings first.
  if (test.modifiers.includes("only")) add("error", ".only is left in, so the file's other tests do not run.", "fact:only");
  if (test.modifiers.includes("skip") || test.modifiers.includes("todo")) add("warn", "Skipped. Fix it or delete it.", `fact:${test.modifiers.includes("skip") ? "skip" : "todo"}`);
  if (!test.modifiers.includes("todo") && facts.assertions === 0) add("error", "Asserts nothing, so it can only fail by throwing.", "fact:no-assertion");
  if (facts.assertions && facts.weak === facts.assertions) add("warn", "Only weak assertions (truthy, defined, type, snapshot). Assert exact values.", `fact:weak=${facts.weak}/${facts.assertions}`);
  if (facts.sleeps) add("warn", "Sleeps or waits a fixed time, which makes it slow and flaky. Wait for a condition instead.", `fact:sleeps=${facts.sleeps}`);
  if (facts.cssSelectors) add("warn", "Finds elements by CSS class or id. Use roles, labels or text, as a user would.", `fact:css=${facts.cssSelectors}`);
  if (facts.realClock && !file.fakeClock) add("info", "Reads the real clock; results can change with the date.", `fact:clock=${facts.realClock}`);
  if (!answers) return result;

  const get = reader(answers, result.readings);
  const visible = get("user_visible");
  const specific = get("specific");
  const mocked = get("over_mocked");
  const vacuous = get("vacuous");
  const plain = get("plain_name");
  const matches = get("name_matches");
  const one = get("one_behaviour");
  const flaky = get("flaky");
  const action = choice(answers, "action");
  result.readings.action = action.choice;
  result.readings.action_probabilities = action.probabilities;

  // Type-level assertions run in the typechecker, so passing at run time says nothing about them.
  const runsAssertions = facts.assertions > facts.typeAssertions;
  if (vacuous >= T.vacuousError && runsAssertions) add("error", "Could pass with the code under test deleted.", jevSource("vacuous", vacuous));
  else if (vacuous >= T.vacuousWarn && runsAssertions) add("warn", "Might pass even if the code broke.", jevSource("vacuous", vacuous));
  if (visible < T.implementationDetail) add("warn", "Tests implementation details. Assert what a caller or user would see.", jevSource("user_visible", visible));
  if (specific < T.specificWarn && !result.issues.some((issue) => issue.source.startsWith("fact:weak"))) add("warn", "Assertions are loose. Check exact values.", jevSource("specific", specific));
  if (mocked >= T.overMocked) add("warn", "Mocks so much it mostly tests the mocks.", jevSource("over_mocked", mocked));
  // Table-driven names are templates, so only a clearly bad one counts.
  const plainCut = isTable(test) ? T.plainNameTable : T.plainName;
  if (plain < plainCut) add("warn", "Name it as a plain sentence saying what should happen.", jevSource("plain_name", plain));
  else if (matches < T.nameMatches) add("warn", "Does not check what its name says.", jevSource("name_matches", matches));
  if (one < T.oneBehaviour) add("warn", "Checks several unrelated things. Split it.", jevSource("one_behaviour", one));
  // In a file that runs in order on purpose, leaning on earlier tests is the design.
  if (flaky >= (file.endToEnd ? T.flakyEndToEnd : T.flaky) && !facts.sleeps && !file.serial) add("warn", "Could fail at random (timing, clock, or test order).", jevSource("flaky", flaky));
  return result;
}
