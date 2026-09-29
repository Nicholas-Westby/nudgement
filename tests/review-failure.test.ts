import { expect, spyOn, test } from "bun:test";
import { evaluateFile } from "../src/code-evaluate";
import { evaluateReadme } from "../src/readme-evaluate";
import { failed, formatAny } from "../src/report";
import { fakeFetch } from "./fake-fetch";

test("marks code and README reviews as failed when Jev is unavailable", async () => {
  const network = spyOn(globalThis, "fetch").mockImplementation(
    fakeFetch(async () => new Response("unavailable", { status: 401 })),
  );
  try {
    const results = await Promise.all([
      evaluateFile({
        path: "price.ts",
        text: "export function total(price: number, count: number) { return price * count; }",
      }),
      evaluateReadme({ path: "README.md", text: "# Price\n\nCalculates order totals.\n" }),
    ]);
    for (const result of results) {
      expect(result.verdict).toBe("fail");
      expect(failed(result)).toBe(true);
      expect(result.issues.filter((issue) => issue.source === "nudgement").map((issue) => issue.severity)).toEqual([
        "error",
      ]);
      expect(formatAny(result, false)).toContain("this review is incomplete");
    }
  } finally {
    network.mockRestore();
  }
});
