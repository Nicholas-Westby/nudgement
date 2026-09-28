/**
 * Finds the tests in a Swift file, both Swift Testing's @Test functions and
 * XCTest's test methods, and counts the same facts as for a JavaScript test.
 * Strings and comments are blanked out before searching, as for JavaScript.
 */

import type { FoundTest, TestFacts } from "./test-parse";

/** The source with every string's contents and every comment replaced by spaces, keeping offsets. */
function blankSwift(source: string): string {
  const out = source.split("");
  const fill = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  // Returns the index just past the string that opens at `start` (on its first # or quote).
  const skipString = (start: number): number => {
    let i = start;
    let hashes = 0;
    while (source[i] === "#") (hashes++, i++);
    const multiline = source.startsWith('"""', i);
    const quote = multiline ? '"""' : '"';
    const close = quote + "#".repeat(hashes);
    const escape = "\\" + "#".repeat(hashes);
    const bodyStart = i + quote.length;
    let j = bodyStart;
    while (j < source.length && !source.startsWith(close, j)) {
      if (!multiline && source[j] === "\n") break;
      if (source.startsWith(escape, j)) {
        j += escape.length;
        // An interpolation such as \(f("x")) may hold strings of its own.
        if (source[j] === "(") j = skipParens(j);
        else j++;
      } else j++;
    }
    fill(bodyStart, j);
    return source.startsWith(close, j) ? j + close.length : j;
  };
  const skipParens = (open: number): number => {
    let depth = 0;
    let j = open;
    while (j < source.length) {
      if (source[j] === '"' || (source[j] === "#" && /^#+"/.test(source.slice(j, j + 8)))) {
        j = skipString(j);
        continue;
      }
      if (source[j] === "(") depth++;
      else if (source[j] === ")" && --depth === 0) return j + 1;
      j++;
    }
    return j;
  };
  let i = 0;
  while (i < source.length) {
    if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i);
      fill(i, end < 0 ? source.length : end);
      i = end < 0 ? source.length : end;
    } else if (source.startsWith("/*", i)) {
      // Swift block comments nest.
      let depth = 0;
      let j = i;
      while (j < source.length) {
        if (source.startsWith("/*", j)) (depth++, (j += 2));
        else if (source.startsWith("*/", j)) {
          j += 2;
          if (--depth === 0) break;
        } else j++;
      }
      fill(i, j);
      i = j;
    } else if (source[i] === '"' || (source[i] === "#" && /^#+"/.test(source.slice(i, i + 8)))) {
      i = skipString(i);
    } else i++;
  }
  return out.join("");
}

/** Where the bracket at `open` closes, in source with its strings and comments blanked. Used for JS tests too. */
export function matching(blanked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < blanked.length; i++) {
    const char = blanked[i];
    if (char === "(" || char === "[" || char === "{") depth++;
    else if (char === ")" || char === "]" || char === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return blanked.length - 1;
}

const lineAt = (source: string, offset: number) => source.slice(0, offset).split("\n").length;

// The display name is the attribute's first argument when that is a string literal.
function displayName(source: string, blanked: string, open: number, close: number): string | undefined {
  const first = /^\(\s*"/.exec(blanked.slice(open, close));
  if (!first) return undefined;
  const start = open + first[0].length;
  const end = blanked.indexOf('"', start);
  return source.slice(start, end);
}

const XCTEST_METHOD = /^(x|_+|disabled_?|DISABLED_)?test/;

/** Every @Test function and XCTest test method in the file, in source order. */
export function findSwiftTests(source: string): FoundTest[] {
  const blanked = blankSwift(source);
  const xctest = /\bXCTestCase\b/.test(blanked);
  const found: FoundTest[] = [];
  const scopes: { name: string; end: number; disabled: boolean }[] = [];
  let suite: { name?: string; disabled: boolean } | undefined;
  let pending: { start: number; name?: string; modifiers: string[] } | undefined;
  const token = /@(Suite|Test)\b|\b(struct|class|actor|enum|extension)\s+(?!(func|var|let|init|subscript)\b)(\w+)|\bfunc\s+(`[^`\n]+`|\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(blanked))) {
    while (scopes.length && scopes.at(-1)!.end < match.index) scopes.pop();
    const after = match.index + match[0].length;
    const args = /^\s*\(/.exec(blanked.slice(after));
    const argsOpen = args ? after + args[0].length - 1 : -1;
    const argsClose = args ? matching(blanked, argsOpen) : -1;
    const argsText = args ? blanked.slice(argsOpen, argsClose + 1) : "";
    if (match[1] === "Suite") {
      suite = { name: args ? displayName(source, blanked, argsOpen, argsClose) : undefined, disabled: /\.disabled\s*\(/.test(argsText) };
    } else if (match[1] === "Test") {
      const modifiers: string[] = [];
      if (/\.disabled\s*\(/.test(argsText)) modifiers.push("skip");
      if (/\barguments\s*:/.test(argsText)) modifiers.push("arguments");
      pending = { start: match.index, name: args ? displayName(source, blanked, argsOpen, argsClose) : undefined, modifiers };
    } else if (match[2]) {
      const open = blanked.indexOf("{", after);
      if (open < 0) continue;
      scopes.push({ name: suite?.name ?? match[4], end: matching(blanked, open), disabled: suite?.disabled ?? false });
      suite = undefined;
      pending = undefined;
    } else {
      const name = match[5].replace(/^`|`$/g, "");
      const test = pending;
      pending = undefined;
      const paramsOpen = blanked.indexOf("(", after);
      if (paramsOpen < 0) continue;
      const paramsClose = matching(blanked, paramsOpen);
      const bodyOpen = blanked.indexOf("{", paramsClose);
      if (bodyOpen < 0) continue;
      const bodyClose = matching(blanked, bodyOpen);
      // XCTest runs a class's methods whose names start with "test" and take no arguments.
      const xcMethod = !test && xctest && XCTEST_METHOD.test(name) && !blanked.slice(paramsOpen + 1, paramsClose).trim() && scopes.length > 0;
      if (!test && !xcMethod) continue;
      const modifiers = test ? [...test.modifiers] : [];
      const skipped = (xcMethod && !name.startsWith("test")) || scopes.some((scope) => scope.disabled);
      if (skipped && !modifiers.includes("skip")) modifiers.unshift("skip");
      const start = test ? test.start : match.index;
      found.push({
        name: test?.name ?? name,
        modifiers,
        describe: scopes.map((scope) => scope.name),
        startLine: lineAt(source, start),
        endLine: lineAt(source, bodyClose),
        code: source.slice(start, bodyClose + 1),
        language: "swift",
      });
      // Skip past the body, so a function inside a test is not taken for one.
      token.lastIndex = bodyClose;
    }
  }
  return found;
}

const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

// `_ = try find(...)` calls a lookup only for its throwing, as ViewInspector tests do.
const ASSERTION = /#(expect|require)\s*[({]|\bXCT(Assert\w*|Unwrap|Fail)\s*\(|\bIssue\.record\s*\(|\b(expect|assert)[A-Z_]\w*\s*\(|\bwait\s*\(\s*for\s*:|\bfulfillment\s*\(\s*of\s*:|\bconfirmation\s*\(|(?<![\w.])_\s*=\s*try(?![?!\w])/g;

// The first argument of the call whose parenthesis opens at `open`.
function firstArgument(blanked: string, open: number): string {
  const close = matching(blanked, open);
  let depth = 0;
  for (let i = open + 1; i < close; i++) {
    const char = blanked[i];
    if (char === "(" || char === "[" || char === "{") depth++;
    else if (char === ")" || char === "]" || char === "}") depth--;
    else if (char === "," && depth === 0) return blanked.slice(open + 1, i).trim();
  }
  return blanked.slice(open + 1, close).trim();
}

// Whether a condition only says a value exists or a collection is not empty,
// the Swift form of toBeDefined(), toBeTruthy() and toBeGreaterThan(0).
function onlyExists(condition: string, holds: boolean): boolean {
  const c = condition.replace(/\s+/g, " ").trim();
  if (holds) {
    return (
      /!= ?nil$|^nil ?!=/.test(c) ||
      /^![\w.?()[\]]+\.isEmpty$/.test(c) ||
      /\.isEmpty ?== ?false$/.test(c) ||
      /\.count ?(> ?0|>= ?1|!= ?0)$/.test(c) ||
      /^[\w.?()[\]]+ is [A-Z][\w.<>]*$/.test(c)
    );
  }
  return /== ?nil$|^nil ?==/.test(c) || /^[\w.?()[\]]+\.isEmpty$/.test(c) || /\.count ?== ?0$/.test(c);
}

function isWeak(blanked: string, match: RegExpExecArray): boolean {
  const name = match[0].replace(/\s*\($/, "");
  const open = match.index + match[0].length - 1;
  if (blanked[open] !== "(") return false;
  const argument = firstArgument(blanked, open);
  if (name === "XCTAssertNotNil") return true;
  if (name === "XCTUnwrap" || name === "#require") {
    // Used as a value, it only unwraps an optional: the test's toBeDefined().
    const before = blanked.slice(0, match.index).replace(/[ \t]*(try[?!]?)?[ \t]*(await)?[ \t]*$/, "");
    const unwraps = name === "XCTUnwrap" || !/(^|[\n;{}])\s*$/.test(before);
    if (unwraps) return true;
  }
  if (["#expect", "#require", "XCTAssert", "XCTAssertTrue"].includes(name)) return onlyExists(argument, true);
  if (name === "XCTAssertFalse") return onlyExists(argument, false);
  if (name === "XCTAssertGreaterThan") return /\.count$/.test(argument) && /,\s*0\s*\)$/.test(blanked.slice(open, matching(blanked, open) + 1));
  return false;
}

const CONTROL = /^\s*(\}\s*)?(if|guard|for|while|switch|else|do|catch|defer|repeat|case|default)\b/;

// What the brace that opens at `open` starts: a closure, a loop, or the body of
// an if, do or the like.
function blockAt(blanked: string, open: number): "closure" | "loop" | "other" {
  const before = blanked.slice(0, open).trimEnd();
  if (/[=(,:[]$|\breturn$|\bin$/.test(before)) return "closure";
  if (/\brepeat$/.test(before)) return "loop";
  if (/\b(else|do|defer|try)$/.test(before)) return "other";
  const line = before.slice(before.lastIndexOf("\n") + 1);
  if (/^\s*(for|while)\b/.test(line)) return "loop";
  return CONTROL.test(line) ? "other" : "closure";
}

// A sleep inside a closure belongs to a stub or a background task, and one
// inside a loop polls for a condition; neither is the test waiting a fixed time.
function fixedWait(blanked: string, offset: number): boolean {
  const opens: number[] = [];
  for (let i = 0; i < offset; i++) {
    if (blanked[i] === "{") opens.push(i);
    else if (blanked[i] === "}") opens.pop();
  }
  // The outermost brace is the test's own body when the code is a whole test.
  const body = /^\s*(@|func\b)/.test(blanked) ? 1 : 0;
  return opens.slice(body).every((open) => blockAt(blanked, open) === "other");
}

export function swiftTestFacts(code: string): TestFacts {
  const blanked = blankSwift(code);
  let assertions = 0;
  let weak = 0;
  let callCountAssertions = 0;
  for (const match of blanked.matchAll(ASSERTION)) {
    assertions++;
    if (isWeak(blanked, match)) weak++;
    const open = match.index + match[0].length - 1;
    if (blanked[open] === "(" && /\b(callCount|calls\.count|invocations\.count|timesCalled)\b/.test(blanked.slice(open, matching(blanked, open)))) callCountAssertions++;
  }
  const sleeps = [...blanked.matchAll(/\b(Task|Thread)\.sleep\s*\(|(?<![\w.])u?sleep\s*\(/g)].filter((match) => fixedWait(blanked, match.index)).length;
  // An inverted expectation passes only by waiting out its whole timeout.
  const invertedWaits = /\.isInverted\s*=\s*true/.test(blanked) ? count(blanked, /\bwait\s*\(\s*for\s*:|\bfulfillment\s*\(\s*of\s*:/g) : 0;
  return {
    assertions,
    typeAssertions: 0,
    weak,
    mocks: count(blanked, /\b(?=[A-Z])\w*(Mock|Spy|Stub|Fake)\w*\s*\(/g),
    callCountAssertions,
    sleeps: sleeps + invertedWaits,
    cssSelectors: 0,
    realClock: count(blanked, /\bDate\s*\(\s*\)|\bDate\.now\b/g),
  };
}
