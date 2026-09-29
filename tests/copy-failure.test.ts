import { expect, spyOn, test } from "bun:test";
import { evaluateCopy, stringQuestions } from "../src/copy-evaluate";
import { fakeFetch } from "./fake-fetch";

// A successful basic copy check must not hide a failure of the separate prose review.
test("fails an incomplete prose review and limits both reviews to touched strings", async () => {
  const selected = { text: "This paragraph explains how to review a commit.", role: "text" as const, line: 2 };
  const answers = Object.fromEntries(
    Object.keys(stringQuestions(selected.role, selected.text)).map((key) => [key, { type: "noul", noul: 0.5 }]),
  );
  let calls = 0;
  const network = spyOn(globalThis, "fetch").mockImplementation(
    fakeFetch(async () => {
      calls++;
      return calls === 1 ? Response.json({ answers }) : new Response("Unavailable", { status: 401 });
    }),
  );
  try {
    const result = await evaluateCopy(
      {
        path: "page.html",
        text: "",
        found: [{ ...selected, line: 1, text: "This untouched paragraph must not spend another request." }, selected],
      },
      { touched: new Set([2]) },
    );
    expect(result.strings.map((item) => item.line)).toEqual([2]);
    expect(result.verdict).toBe("fail");
    expect(result.jev.requests).toBe(2);
    expect(result.jev.failed).toBe(1);
    expect(result.issues[0].message).toContain("this review is incomplete");
    expect(calls).toBe(2);
  } finally {
    network.mockRestore();
  }
});
