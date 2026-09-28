import { expect, test } from "bun:test";
import type { Answer, Answers } from "../src/jev";
import { judgeTest, nameForJev, testFileState } from "../src/test-evaluate";
import { findTests } from "../src/test-parse";

const noulOf = (value: number): Answer => ({ type: "noul", noul: value });
const answers = (flaky: number, vacuous = 0.05): Answers => ({
  user_visible: noulOf(0.9),
  specific: noulOf(0.9),
  over_mocked: noulOf(0.05),
  vacuous: noulOf(vacuous),
  plain_name: noulOf(0.9),
  name_matches: noulOf(0.9),
  one_behaviour: noulOf(0.9),
  flaky: noulOf(flaky),
  action: { type: "choice", choice: "keep", confidence: 0.9, probabilities: { keep: 0.9 } },
});
const [found] = findTests('test("shows the event on its day", async ({ page }) => {\n  await page.goto(url);\n  await expect(page.getByRole("link", { name })).toHaveCount(1);\n});\n');
const flagged = (flaky: number, file: { endToEnd?: boolean; serial?: boolean }) =>
  judgeTest(found, answers(flaky), { fakeClock: false, endToEnd: false, serial: false, ...file }).issues.some((issue) => issue.source.startsWith("jev:flaky"));

test("holds end-to-end tests to a higher flakiness bar, since they must use the real clock", () => {
  expect(flagged(0.72, {})).toBe(true);
  expect(flagged(0.72, { endToEnd: true })).toBe(false);
  expect(flagged(0.85, { endToEnd: true })).toBe(true);
});

test("does not call a test flaky for relying on earlier tests in a file that runs in order", () => {
  expect(flagged(0.85, { endToEnd: true, serial: true })).toBe(false);
});

test("does not call a type-level test vacuous, since the typechecker is what runs it", () => {
  const [typeLevel] = findTests('it("is a type of its own", () => {\n  expectTypeOf<Pick<Template, keyof Template>>().not.toExtend<Template>();\n});\n');
  const file = { fakeClock: false, endToEnd: false, serial: false };
  const sources = (found: typeof typeLevel) => judgeTest(found, answers(0.1, 0.9), file).issues.map((issue) => issue.source);
  expect(sources(typeLevel).some((source) => source.startsWith("jev:vacuous"))).toBe(false);
  expect(sources(found).some((source) => source.startsWith("jev:vacuous"))).toBe(true);
});

test("judges a Swift test by its #expect assertions", () => {
  const [swift] = findTests("@Test func keepsLeeds() {\n    #expect(model.lastError != nil)\n}\n", "Tests/ForecastTests.swift");
  const sources = judgeTest(swift, undefined, { fakeClock: false, endToEnd: false, serial: false }).issues.map((issue) => issue.source);
  expect(sources).toEqual(["fact:weak=1/1"]);
});

test("names the Swift test framework from the file's imports", () => {
  expect(testFileState("Tests/SlugTests.swift", "import Testing\n@testable import Core\n").framework).toBe("swift-testing");
  expect(testFileState("Tests/SlugTests.swift", "import XCTest\n@testable import Core\n").framework).toBe("xctest");
});

test("shows Jev a Swift function name as the words it spells", () => {
  const [camel, xctest, named] = findTests('@Test func lowerBoundaryAlphaIsKept() {}\nfinal class A: XCTestCase {\n    func testRejectsURLsOutOfRange() {}\n}\n@Test("keeps the name") func keeps() {}\n', "Tests/ATests.swift");
  expect([camel, xctest, named].map(nameForJev)).toEqual(["lower boundary alpha is kept", "rejects URLs out of range", "keeps the name"]);
});

test("shows Jev a table test's placeholders as values", () => {
  const [table] = findTests('test.each([[1]])("parses %i", (n) => {});\n');
  expect(nameForJev(table)).toBe("parses <value>");
});
