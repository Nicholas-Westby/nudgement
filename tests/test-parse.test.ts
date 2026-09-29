import { expect, test } from "bun:test";
import { testFileState } from "../src/test-evaluate";
import { declaresSerialOrder, findTests, isTestFile, testFacts } from "../src/test-parse";

const SOURCE = `import { describe, expect, it, test, vi } from "vitest";
import { app } from "../src/app";

const re = /test/;
re.test("x");

describe("loans", () => {
  it("refuses a loan once the member has five books out", async () => {
    const response = await app.request("/members/1/loans", { method: "POST" });
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("already has five books");
  });

  it.only('works', () => {
    // a comment with test("inside") in it
    expect(thing()).toBeTruthy();
  });

  test.skip(\`handles \${"edge"} case\`, () => {});

  test.each([[1], [2]])("parses %i", (n) => {
    expect(parse(n)).toEqual({ ok: true, value: n });
  });
});

test("nothing here", () => {
  setTimeout(() => {}, 100);
});
`;

test("finds each test with its name, modifiers, lines and describe path", () => {
  const found = findTests(SOURCE);
  expect(found.map((t) => t.name)).toEqual([
    "refuses a loan once the member has five books out",
    "works",
    'handles ${"edge"} case',
    "parses %i",
    "nothing here",
  ]);
  expect(found.map((t) => t.modifiers)).toEqual([[], ["only"], ["skip"], ["each"], []]);
  expect(found[0].startLine).toBe(8);
  expect(found[0].endLine).toBe(12);
  expect(found[0].describe).toEqual(["loans"]);
  expect(found[4].describe).toEqual([]);
});

test("does not mistake regex .test() calls or text in comments for tests", () => {
  expect(findTests(SOURCE).some((t) => t.name === "inside")).toBe(false);
  expect(findTests("const ok = /a/.test(s);\n")).toEqual([]);
});

test("counts assertions, weak matchers, mocks, sleeps and selectors", () => {
  const [full, works, , , nothing] = findTests(SOURCE);
  expect(testFacts(full.code)).toMatchObject({ assertions: 2, weak: 0 });
  expect(testFacts(works.code)).toMatchObject({ assertions: 1, weak: 1 });
  expect(testFacts(nothing.code)).toMatchObject({ assertions: 0, sleeps: 1 });
  const playwright =
    'await page.locator(".btn-primary").click();\nawait page.waitForTimeout(500);\nawait expect(page.getByText("Renewed")).toBeVisible();';
  expect(testFacts(playwright)).toMatchObject({ assertions: 1, sleeps: 1, cssSelectors: 1 });
  expect(testFacts("vi.spyOn(repo, 'insert');\nexpect(repo.insert).toHaveBeenCalledTimes(1);")).toMatchObject({
    mocks: 1,
    callCountAssertions: 1,
  });
});

test("counts toBeUndefined as an exact assertion, not a weak one", () => {
  expect(testFacts("expect(process.exitCode).toBeUndefined();")).toMatchObject({ assertions: 1, weak: 0 });
  expect(testFacts("expect(result).toBeDefined();")).toMatchObject({ assertions: 1, weak: 1 });
});

test("recognizes test files", () => {
  expect(isTestFile("tests/unit/due-date.test.ts")).toBe(true);
  expect(isTestFile("e2e/renew.spec.ts")).toBe(true);
  expect(isTestFile("src/due-date.ts")).toBe(false);
});

test("treats helpers and setup files beside end-to-end tests as code, not tests", () => {
  expect(isTestFile("tests/e2e/support/pages.ts")).toBe(false);
  expect(isTestFile("tests/e2e/database.setup.ts")).toBe(false);
  expect(isTestFile("cypress/e2e/renew.cy.ts")).toBe(true);
  expect(isTestFile("src/__tests__/due-date.ts")).toBe(true);
});

test("counts a call to a helper named expect... or assert... as an assertion", () => {
  expect(testFacts("await expectNotFoundPage(page, await page.goto(`/shelves/${shelf}`));")).toMatchObject({
    assertions: 1,
  });
  expect(testFacts("assertValidLoan(loan);")).toMatchObject({ assertions: 1 });
  expect(testFacts("const expected = 3;\nexpectation(x);")).toMatchObject({ assertions: 0 });
});

test("names the framework from the file's own imports, not from imports quoted in a fixture", () => {
  const quoting = 'import { expect, test } from "bun:test";\nconst SOURCE = `import { it } from "vitest";`;\n';
  expect(testFileState("a.test.ts", quoting).framework).toBe("bun");
  expect(
    testFileState("e.spec.ts", 'import type { Page } from "@playwright/test";\nimport { test } from "./fixtures";\n')
      .framework,
  ).toBe("playwright");
});

test("spots a file that runs its tests in order on purpose", () => {
  expect(declaresSerialOrder('test.describe.configure({ mode: "serial" });')).toBe(true);
  expect(declaresSerialOrder("test.describe.serial('story', () => {});")).toBe(true);
  expect(declaresSerialOrder('test.describe.configure({ mode: "parallel" });')).toBe(false);
});

test("counts type-level assertions with type arguments, such as expectTypeOf<T>()", () => {
  expect(testFacts("expectTypeOf<Pick<LoanPolicy, keyof LoanPolicy>>().not.toExtend<LoanPolicy>();")).toMatchObject({
    assertions: 1,
  });
  expect(testFacts("assertType<string>(name);")).toMatchObject({ assertions: 1 });
});

test("counts expect.soft() split across lines by a formatter", () => {
  expect(
    testFacts("expect\n  .soft(\n    score,\n    `scores: ${scores}`,\n  )\n  .toBeGreaterThanOrEqual(0.9);"),
  ).toMatchObject({ assertions: 1 });
});
