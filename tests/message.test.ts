import { describe, expect, test } from "bun:test";
import { lint, parseMessage } from "../src/message";

const rules = (message: string) => lint(parseMessage(message)).map((issue) => issue.source);

describe("parseMessage", () => {
  test("splits header, bullets and trailers", () => {
    const parsed = parseMessage(
      "fix(hero): add video option\n\n- Include AB test\n- Render image to canvas\n\nSee: https://x.test/1\nCo-Authored-By: Bot <b@x>"
    );
    expect(parsed.type).toBe("fix");
    expect(parsed.scope).toBe("hero");
    expect(parsed.subject).toBe("add video option");
    expect(parsed.bullets).toEqual(["Include AB test", "Render image to canvas"]);
    expect(parsed.trailers).toHaveLength(2);
    expect(parsed.judged).not.toContain("Co-Authored-By");
  });

  test("joins a wrapped bullet onto the one above", () => {
    expect(parseMessage("feat: x\n\n- one\n  more\n- two").bullets).toEqual(["one more", "two"]);
  });

  test("a body line that merely looks like a trailer is not one", () => {
    const parsed = parseMessage("feat: x\n\n- one\nNote: this is prose");
    expect(parsed.trailers).toEqual([]);
  });
});

describe("lint", () => {
  test("a clean message has no findings", () => {
    expect(rules("fix(hero): add video option for hero banner\n\n- Include AB test for autoplay")).toEqual([]);
  });

  test("flags the header rules", () => {
    expect(rules("Added stuff")).toContain("lint:format");
    expect(rules("feature: add x")).toContain("lint:type-known");
    expect(rules(`feat: ${"a".repeat(70)}`)).toContain("lint:header-length");
    expect(lint(parseMessage(`feat: ${"a".repeat(70)}`)).find((issue) => issue.source === "lint:header-length")?.message).toContain("Cut at least 4.");
    expect(rules("feat: add x.")).toContain("lint:subject-period");
    expect(rules("feat: Add x")).toContain("lint:subject-case");
    expect(rules("feat: added x")).toContain("lint:subject-imperative");
    expect(rules("feat(): add x")).toContain("lint:scope-empty");
  });

  test("reads any first word ending in -ed or -ing as not imperative, but not base verbs that end that way", () => {
    expect(rules("perf(cart): enhanced the total")).toContain("lint:subject-imperative");
    expect(rules("fix: documenting the flags")).toContain("lint:subject-imperative");
    expect(rules("fix: embed the fonts")).not.toContain("lint:subject-imperative");
    expect(rules("fix: bring back the header")).not.toContain("lint:subject-imperative");
    expect(rules("test: pin share ends")).not.toContain("lint:subject-imperative");
  });

  test("allows exactly 72 characters", () => {
    const header = `feat: ${"a".repeat(66)}`;
    expect(header).toHaveLength(72);
    expect(rules(header)).not.toContain("lint:header-length");
  });

  test("flags body rules", () => {
    expect(rules("feat: add x\n\n- a\n- b\n- c\n- d")).toContain("lint:bullet-count");
    expect(rules("feat: add x\n- a")).toContain("lint:blank-line");
    expect(rules("feat: add x\n\nThis is a paragraph.")).toContain("lint:body-bullets-only");
    expect(rules(`feat: add x\n\n- ${"a".repeat(80)}`)).toContain("lint:bullet-length");
  });

  test("flags AI words and emoji but not in trailers", () => {
    expect(rules("feat: add robust retry logic")).toContain("lint:ai-words");
    expect(rules("feat: add retry ✨")).toContain("lint:emoji");
    expect(rules("feat: add retry\n\nCo-Authored-By: Claude <robust@x>")).toEqual([]);
  });
});

describe("lint with repo rules", () => {
  const withRules = (message: string, rules: Parameters<typeof lint>[1]) => lint(parseMessage(message), rules).map((issue) => issue.source);

  test("forbids trailers when the repo has none", () => {
    const message = "feat: add x\n\nCo-Authored-By: Bot <b@x>";
    expect(withRules(message, { forbidTrailers: true })).toContain("lint:trailers");
    expect(withRules(message, {})).not.toContain("lint:trailers");
  });

  test("forbids words anywhere in the message, as whole words", () => {
    expect(withRules("feat: add the interview notes", { forbiddenWords: ["interview"] })).toContain("lint:forbidden-word");
    expect(withRules("feat: add interviewer tools", { forbiddenWords: ["interview"] })).not.toContain("lint:forbidden-word");
  });
});
