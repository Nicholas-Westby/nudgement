import { type Answers, choice } from "./jev";
import type { Issue } from "./message";
import { jevSource, reader } from "./run";
import { isTable, type TestResult } from "./test-evaluate";
import { type FoundTest, testFacts } from "./test-parse";

// Benchmarked 2026-09-26 on 168 labelled tests in 24 files (bench/tests).
// Name-match probabilities produced false alarms; reserve warnings for very low readings.
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
  // End-to-end tests often depend on real timing and services; use a higher flakiness threshold.
  flakyEndToEnd: 0.78,
  orderDependent: 0.6,
  // Happy-path-only benchmark files scored at most 0.14; broader coverage started at 0.20.
  edgeCases: 0.17,
  duplicatedSetup: 0.7,
};

export const T = TEST_THRESHOLDS;

export function judgeTest(
  test: FoundTest,
  answers: Answers | undefined,
  file: { fakeClock: boolean; endToEnd: boolean; serial: boolean },
): TestResult {
  const result: TestResult = {
    name: test.name,
    describe: test.describe,
    startLine: test.startLine,
    endLine: test.endLine,
    issues: [],
    readings: {},
  };
  const add = (severity: Issue["severity"], message: string, source: string) =>
    result.issues.push({ severity, part: test.name, message, source });
  const facts = testFacts(test.code, test.language);
  result.readings.facts = facts;

  if (test.modifiers.includes("only"))
    add("error", ".only is left in, so the file's other tests do not run.", "fact:only");
  if (test.modifiers.includes("skip") || test.modifiers.includes("todo"))
    add("warn", "Skipped. Fix it or delete it.", `fact:${test.modifiers.includes("skip") ? "skip" : "todo"}`);
  if (!test.modifiers.includes("todo") && facts.assertions === 0)
    add("error", "Asserts nothing, so it can only fail by throwing.", "fact:no-assertion");
  if (facts.assertions && facts.weak === facts.assertions)
    add(
      "warn",
      "Only weak assertions (truthy, defined, type, snapshot). Assert exact values.",
      `fact:weak=${facts.weak}/${facts.assertions}`,
    );
  if (facts.sleeps)
    add(
      "warn",
      "Sleeps or waits a fixed time, which makes it slow and flaky. Wait for a condition instead.",
      `fact:sleeps=${facts.sleeps}`,
    );
  if (facts.cssSelectors)
    add(
      "warn",
      "Finds elements by CSS class or id. Use roles, labels or text, as a user would.",
      `fact:css=${facts.cssSelectors}`,
    );
  if (facts.realClock && !file.fakeClock)
    add("info", "Reads the real clock; results can change with the date.", `fact:clock=${facts.realClock}`);
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
  if (vacuous >= T.vacuousError && runsAssertions)
    add("error", "Could pass with the code under test deleted.", jevSource("vacuous", vacuous));
  else if (vacuous >= T.vacuousWarn && runsAssertions)
    add("warn", "Might pass even if the code broke.", jevSource("vacuous", vacuous));
  if (visible < T.implementationDetail)
    add(
      "warn",
      "Tests implementation details. Assert what a caller or user would see.",
      jevSource("user_visible", visible),
    );
  if (specific < T.specificWarn && !result.issues.some((issue) => issue.source.startsWith("fact:weak")))
    add("warn", "Assertions are loose. Check exact values.", jevSource("specific", specific));
  if (mocked >= T.overMocked) add("warn", "Mocks so much it mostly tests the mocks.", jevSource("over_mocked", mocked));
  // Table-driven names are templates, so only a clearly bad one counts.
  const plainCut = isTable(test) ? T.plainNameTable : T.plainName;
  if (plain < plainCut)
    add("warn", "Name it as a plain sentence saying what should happen.", jevSource("plain_name", plain));
  else if (matches < T.nameMatches)
    add("warn", "Does not check what its name says.", jevSource("name_matches", matches));
  if (one < T.oneBehaviour) add("warn", "Checks several unrelated things. Split it.", jevSource("one_behaviour", one));
  // In a file that runs in order on purpose, leaning on earlier tests is the design.
  if (flaky >= (file.endToEnd ? T.flakyEndToEnd : T.flaky) && !facts.sleeps && !file.serial)
    add("warn", "Could fail at random (timing, clock, or test order).", jevSource("flaky", flaky));
  return result;
}
