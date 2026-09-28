import { afterEach, expect, it, type MockInstance, vi } from "vitest";
import { logError, logInfo } from "./log";

afterEach(() => {
  vi.restoreAllMocks();
});

// Workers Logs reads one JSON object per line, so a pretty-printed object or a second
// argument would split one workshop into several unreadable entries.
function writtenWorkshops(spy: MockInstance<(...data: unknown[]) => void>): unknown[] {
  return spy.mock.calls.map((args) => {
    expect(args).toHaveLength(1);
    const line = String(args[0]);
    expect(line).not.toContain("\n");
    return JSON.parse(line);
  });
}

it("writes an info workshop and its fields as one JSON line", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  logInfo("workshop_created", { workshopId: "x" });

  expect(writtenWorkshops(log)).toEqual([{ level: "info", workshop: "workshop_created", workshopId: "x" }]);
});

it("keeps a field value with a line break inside its own log line", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  logInfo("booking_rejected", { name: 'Alex\n{"level":"error"}' });

  expect(writtenWorkshops(log)).toEqual([
    { level: "info", workshop: "booking_rejected", name: 'Alex\n{"level":"error"}' },
  ]);
});

it("writes an error's message, stack and fields as one JSON line", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});

  logError("unhandled_error", new Error("boom"), { path: "/x" });

  expect(writtenWorkshops(error)).toEqual([
    {
      level: "error",
      workshop: "unhandled_error",
      message: "boom",
      stack: expect.stringMatching(/^Error: boom\n\s+at /),
      path: "/x",
    },
  ]);
});

it("uses a thrown string as the error message", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});

  logError("e", "plain");

  expect(writtenWorkshops(error)).toEqual([{ level: "error", workshop: "e", message: "plain" }]);
});
