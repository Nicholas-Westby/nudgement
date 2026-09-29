import { expect, test } from "bun:test";
import { reviewClarity } from "../src/clarity";
import { evaluateFile } from "../src/code-evaluate";
import type { Answers, Question } from "../src/jev";
import { failed, formatAny } from "../src/report";
import type { Track } from "../src/run";

function probabilityAnswers(questions: Record<string, Question>, value: number): Answers {
  return Object.fromEntries(Object.keys(questions).map((key) => [key, { type: "noul", noul: value }]));
}

test("checks one-line values and all declarations beyond the first request", async () => {
  const requests: unknown[] = [];
  const track: Track = async (_, state, questions) => {
    requests.push(state);
    return probabilityAnswers(questions, 0.9);
  };
  const text = Array.from({ length: 65 }, (_, index) => `export const flag${index} = 0x80;`).join("\n");
  const result = await reviewClarity({ path: "flags.ts", text }, track);
  expect(requests.length).toBeGreaterThan(1);
  expect(result.readings.map((reading) => reading.name)).toEqual(
    Array.from({ length: 65 }, (_, index) => `flag${index}`),
  );
  expect(result.issues).toHaveLength(130);
  expect(result.issues.at(-1)?.part).toContain("flag64 (lines 65-65)");
});

test("limits findings to changed declarations but retains surrounding explanations", async () => {
  const text =
    "// The wire format uses bit seven for acknowledgement.\nconst ACK_MASK = 0x80;\n\nfunction ack(header) { return header & ACK_MASK; }\n\nfunction other() { return 1; }\n";
  let request: unknown;
  const track: Track = async (_, state, questions) => {
    request = state;
    return probabilityAnswers(questions, 0.9);
  };
  const result = await reviewClarity({ path: "frame.ts", text }, track, {
    touched: new Set([4]),
    context: "Decode the existing wire format without changing it.",
  });
  expect(result.readings.map((reading) => reading.name)).toEqual(["ack"]);
  expect(result.issues.every((issue) => issue.part === "ack (lines 4-4)")).toBe(true);
  expect(request).toMatchObject({
    file_context: text.trimEnd(),
    project_requirements: "Decode the existing wire format without changing it.",
  });
});

test("retains a late target when the shared file context is truncated", async () => {
  const text = `/* ${"context ".repeat(16_000)} */\n\nexport const mask = 0x80;`;
  let request: unknown;
  const track: Track = async (_, state, questions) => {
    request = state;
    return probabilityAnswers(questions, 0);
  };
  const result = await reviewClarity({ path: "large.ts", text }, track, { touched: new Set([3]) });
  expect(request).toMatchObject({ targets: [{ name: "mask", code: "export const mask = 0x80;" }] });
  expect(JSON.stringify(request)).toContain("file context truncated");
  expect(result.issues).toEqual([]);
});

test("skips generated files, non-code, imports and untouched declarations without requests", async () => {
  let calls = 0;
  const track: Track = async () => {
    calls++;
    return {};
  };
  for (const input of [
    { path: "data.json", text: "{}" },
    { path: "api.generated.ts", text: "const flag = 0x80;" },
    { path: "empty.ts", text: "" },
    { path: "imports.ts", text: 'import { readFileSync } from "node:fs";' },
  ])
    expect(await reviewClarity(input, track)).toEqual({ issues: [], readings: [] });
  await reviewClarity({ path: "flags.ts", text: "const mask = 0x80;" }, track, { touched: new Set([9]) });
  expect(calls).toBe(0);
});

test("does not manufacture readings when a tracked request fails", async () => {
  const result = await reviewClarity({ path: "flags.ts", text: "const mask = 0x80;" }, async () => undefined);
  expect(result).toEqual({ issues: [], readings: [] });
});

// A partial review of a one-line value has no bloat request; clarity must still reach the report.
test("reports a magic value in changed code even when no bloat unit is eligible", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async (_url: unknown, init?: RequestInit) => {
      const { questions } = JSON.parse(String(init?.body));
      return Response.json({ answers: probabilityAnswers(questions, 0.9) });
    },
    { preconnect() {} },
  );
  try {
    const result = await evaluateFile(
      { path: "flags.ts", text: "export const mask = 0x80;" },
      {
        touched: new Set([1]),
        skipFileLevel: true,
      },
    );
    expect(result.jev.requests).toBe(1);
    expect(result.units).toEqual([]);
    expect(result.issues.map((issue) => issue.source.split("=")[0])).toEqual([
      "jev:missing_explanation",
      "jev:magic_values",
    ]);
    expect(failed(result)).toBe(false);
    expect(formatAny(result, false)).toContain("mask (lines 1-1)");
  } finally {
    globalThis.fetch = original;
  }
});
