import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { findComments } from "../src/comments";
import { judgeComment, withoutMachineRead } from "../src/evaluate";
import { parseDiff } from "../src/git";
import type { Answer, Answers } from "../src/jev";
import { temporaryDirectory } from "./temp-dir";

const diff = (path: string, body: string[]) =>
  [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, `@@ -1,1 +1,${body.length} @@`, ...body].join(
    "\n",
  );

const comments = (path: string, body: string[]) => {
  const [file] = parseDiff(diff(path, body), `${body.filter((l) => l[0] === "+").length}\t0\t${path}`);
  return findComments(file, undefined);
};

test("groups consecutive added comment lines into one comment", () => {
  const found = comments("a.ts", [
    "+// Safari drops the cookie on redirect,",
    "+// so set it again here.",
    "+setCookie();",
    " done();",
  ]);
  expect(found).toHaveLength(1);
  expect(found[0].line).toBe(1);
  expect(found[0].text).toBe("// Safari drops the cookie on redirect,\n// so set it again here.");
  expect(found[0].codeAfter).toContain("setCookie();");
});

test("finds block comments and trailing comments", () => {
  const found = comments("a.ts", [
    "+/**",
    "+ * Returns the name.",
    "+ */",
    "+const x = 1; // retry once, the API 502s on deploy",
  ]);
  expect(found.map((c) => c.trailing)).toEqual([false, true]);
  expect(found[1].codeOnLine).toBe("const x = 1;");
});

test("ignores unchanged comments, URLs, strings and directives", () => {
  const found = comments("a.ts", [
    " // an old comment",
    "+const url = 'https://example.com';",
    '+const s = "a // b";',
    "+// eslint-disable-next-line no-console",
    "+// @ts-expect-error",
    "+// -----",
  ]);
  expect(found).toEqual([]);
});

test("counts an edit to part of an existing comment", () => {
  const found = comments("a.py", [" # keep the first line", "+# and change the second", " x = 1"]);
  expect(found).toHaveLength(1);
  expect(found[0].wholeCommentIsNew).toBe(false);
  expect(found[0].text).toContain("keep the first line");
});

test("skips files it has no comment syntax for", () => {
  expect(comments("data.json", ["+// not a comment"])).toEqual([]);
});

test("finds JSX comments in TSX files", () => {
  const found = comments("Page.tsx", [
    "+return (",
    "+  <div>",
    "+    {/* Members see returned books greyed out, not hidden */}",
    "+    <List />",
    "+    {/*",
    "+      Render the barcode here",
    "+    */}",
    "+  </div>",
    "+);",
  ]);
  expect(found.map((c) => c.text.trim())).toEqual([
    "{/* Members see returned books greyed out, not hidden */}",
    "{/*\n      Render the barcode here\n    */}",
  ]);
});

test("finds comments in an extensionless shell script", () => {
  const [file] = parseDiff(
    diff("bootstrap", [
      "+#!/bin/sh",
      "+# Homebrew puts node on the PATH only after this shell starts.",
      '+eval "$(brew shellenv)"',
    ]),
    "3\t0\tbootstrap",
  );
  const found = findComments(file, [
    "#!/bin/sh",
    "# Homebrew puts node on the PATH only after this shell starts.",
    'eval "$(brew shellenv)"',
  ]);
  expect(found.map((c) => c.text)).toEqual(["# Homebrew puts node on the PATH only after this shell starts."]);
});

test("warns, never fails, when Jev reads a contradiction, more strongly when it is near sure", () => {
  const [comment] = comments("a.ts", [
    "+// Can't be missing here: the order was loaded above.",
    "+if (!order) return notFound();",
  ]);
  const noulOf = (value: number): Answer => ({ type: "noul", noul: value });
  const choiceOf = (value: string): Answer => ({
    type: "choice",
    choice: value,
    confidence: 0.8,
    probabilities: { [value]: 0.8 },
  });
  const answers = (contradicts: number): Answers => ({
    kind: choiceOf("why"),
    action: choiceOf("keep"),
    length: choiceOf("right"),
    narrates_change: noulOf(0.05),
    sounds_human: noulOf(0.9),
    restates_code: noulOf(0.1),
    worth_keeping: noulOf(0.8),
    contradicts_code: noulOf(contradicts),
  });
  const severity = (contradicts: number) =>
    judgeComment(comment, answers(contradicts)).issues.find((issue) => issue.source.startsWith("jev:contradicts_code"))
      ?.severity;
  expect(severity(0.72)).toBe("warn");
  expect(severity(0.9)).toBe("warn");
  expect(
    judgeComment(comment, answers(0.9)).issues.find((issue) => issue.source.startsWith("jev:contradicts_code"))
      ?.message,
  ).toContain("Likely");
  expect(severity(0.3)).toBeUndefined();
});

test("ignores tool directives such as Stryker's, each on its own line", () => {
  for (const directive of [
    "// Stryker restore all",
    "// Stryker disable next-line all: the fallback cannot be reached",
    "/* c8 ignore next */",
    "// @vitest-environment happy-dom",
  ]) {
    expect(comments("a.ts", [`+${directive}`, "+const a = 1;"])).toEqual([]);
  }
});

test("suggests deleting a comment only when Jev also finds it not worth keeping", () => {
  const [comment] = comments("a.ts", [
    "+// Emoji held together by a zero-width joiner and a skin tone.",
    '+export const THUMBS_UP = "\\u{1f44d}\\u{1f3fd}";',
  ]);
  const answers = (keep: number): Answers => ({
    kind: { type: "choice", choice: "what", confidence: 0.6, probabilities: { what: 0.6 } },
    action: { type: "choice", choice: "delete", confidence: 0.7, probabilities: { delete: 0.7, keep: 0.3 } },
    length: { type: "choice", choice: "right", confidence: 0.8, probabilities: { right: 0.8 } },
    narrates_change: { type: "noul", noul: 0.05 },
    sounds_human: { type: "noul", noul: 0.9 },
    restates_code: { type: "noul", noul: 0.3 },
    worth_keeping: { type: "noul", noul: keep },
    contradicts_code: { type: "noul", noul: 0.05 },
  });
  const suggestsDelete = (keep: number) =>
    judgeComment(comment, answers(keep)).issues.some((issue) => issue.source.startsWith("jev:action=delete"));
  expect(suggestsDelete(0.66)).toBe(false);
  expect(suggestsDelete(0.4)).toBe(true);
});

test("does not call a comment that gives the reasons a restatement of the code", () => {
  const [comment] = comments("a.ts", [
    "+// Medium error correction survives a scuffed printout.",
    '+QRCode.toString(url, { errorCorrectionLevel: "M" });',
  ]);
  const answers = (kind: string): Answers => ({
    kind: { type: "choice", choice: kind, confidence: 0.7, probabilities: { [kind]: 0.7 } },
    action: { type: "choice", choice: "keep", confidence: 0.7, probabilities: { keep: 0.7 } },
    length: { type: "choice", choice: "right", confidence: 0.8, probabilities: { right: 0.8 } },
    narrates_change: { type: "noul", noul: 0.05 },
    sounds_human: { type: "noul", noul: 0.9 },
    restates_code: { type: "noul", noul: 0.8 },
    worth_keeping: { type: "noul", noul: 0.6 },
    contradicts_code: { type: "noul", noul: 0.05 },
  });
  const restates = (kind: string) =>
    judgeComment(comment, answers(kind)).issues.some((issue) => issue.source.startsWith("jev:restates_code"));
  expect(restates("why")).toBe(false);
  expect(restates("what")).toBe(true);
});

test("ignores comment markers inside strings that span lines", () => {
  expect(comments("a.test.ts", ["+const swift = `", "+// a Swift comment in a fixture", "+let x = 1", "+`;"])).toEqual(
    [],
  );
  expect(comments("a.py", ['+SQL = """', "+# not a comment, part of the text", '+"""'])).toEqual([]);
  expect(comments("a.sh", ["+cat > notes.md <<'EOF'", "+# A heading, not a comment", "+EOF"])).toEqual([]);
});

test("still finds a comment after a string that spanned lines", () => {
  const found = comments("a.ts", ["+const s = `", "+text", "+`;", "+// Retry once: the API 502s during deploys."]);
  expect(found.map((c) => c.line)).toEqual([4]);
});

test("a tagged comment that other code searches for is left alone, and an ordinary tagged one is not", () => {
  const repo = temporaryDirectory();
  const git = (...args: string[]) =>
    Bun.spawnSync(["git", "-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", ...args]);
  git("init", "-q");
  writeFileSync(join(repo, "Lint.swift"), 'if line.contains("// no-help:") { continue }\n');
  git("add", ".");
  git("commit", "-qm", "lint");
  const found = (text: string) => ({
    path: "View.swift",
    language: "swift",
    line: 3,
    text,
    wholeCommentIsNew: true,
    trailing: true,
    codeBefore: "",
    codeAfter: "",
  });
  const kept = withoutMachineRead(repo, "HEAD", [
    found("// no-help: text label visible"),
    found("// note: the API 502s during deploys"),
  ]);
  expect(kept.map((comment) => comment.text)).toEqual(["// note: the API 502s during deploys"]);
});
