import { afterEach, expect, it, vi } from "vitest";
import SuiteBudgetReporter from "./suite-budget-reporter";

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

function runFor(elapsedMs: number, reason: "passed" | "failed" = "passed") {
  let now = 0;
  const reporter = new SuiteBudgetReporter({ budgetMs: 1_000, now: () => now });
  reporter.onTestRunStart();
  now = elapsedMs;
  reporter.onTestRunEnd([], [], reason);
}

it("fails a passing run that went over its time budget", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  runFor(1_500);
  expect(process.exitCode).toBe(1);
  expect(error).toHaveBeenCalledWith(expect.stringContaining("1500 ms"));
});

it("leaves a run inside its budget alone", () => {
  runFor(900);
  expect(process.exitCode).toBeUndefined();
});

it("does not pile a budget failure onto a run that already failed", () => {
  runFor(1_500, "failed");
  expect(process.exitCode).toBeUndefined();
});

function runForDefaultBudget(elapsedMs: number) {
  let now = 0;
  // Vitest constructs every reporter as `new Reporter(options)`, passing `{}` when the config
  // gives no options for it, so the no-argument-object case has to work like this, not like
  // `new SuiteBudgetReporter()`.
  const reporter = new SuiteBudgetReporter({ now: () => now });
  reporter.onTestRunStart();
  now = elapsedMs;
  reporter.onTestRunEnd([], [], "passed");
}

it("fails a passing run over the default budget when the config gives no options", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  runForDefaultBudget(30_001);
  expect(process.exitCode).toBe(1);
  expect(error).toHaveBeenCalledWith(expect.stringContaining("30001 ms"));
});

it("leaves a run under the default budget alone when the config gives no options", () => {
  runForDefaultBudget(29_999);
  expect(process.exitCode).toBeUndefined();
});
