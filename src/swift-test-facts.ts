import { blankSwift, matching } from "./swift-mask";
import type { TestFacts } from "./test-parse";

const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

// `_ = try find(...)` calls a lookup only for its throwing, as ViewInspector tests do.
const ASSERTION =
  /#(expect|require)\s*[({]|\bXCT(Assert\w*|Unwrap|Fail)\s*\(|\bIssue\.record\s*\(|\b(expect|assert)[A-Z_]\w*\s*\(|\bwait\s*\(\s*for\s*:|\bfulfillment\s*\(\s*of\s*:|\bconfirmation\s*\(|(?<![\w.])_\s*=\s*try(?![?!\w])/g;

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
  if (name === "XCTAssertGreaterThan")
    return /\.count$/.test(argument) && /,\s*0\s*\)$/.test(blanked.slice(open, matching(blanked, open) + 1));
  return false;
}

const CONTROL = /^\s*(\}\s*)?(if|guard|for|while|switch|else|do|catch|defer|repeat|case|default)\b/;

function blockAt(blanked: string, open: number): "closure" | "loop" | "other" {
  const before = blanked.slice(0, open).trimEnd();
  if (/[=(,:[]$|\breturn$|\bin$/.test(before)) return "closure";
  if (/\brepeat$/.test(before)) return "loop";
  if (/\b(else|do|defer|try)$/.test(before)) return "other";
  const line = before.slice(before.lastIndexOf("\n") + 1);
  if (/^\s*(for|while)\b/.test(line)) return "loop";
  return CONTROL.test(line) ? "other" : "closure";
}

// Closure sleeps belong to stubs or background work; loop sleeps may be polling.
// Only unconditional waits in the test body count as fixed delays.
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
    if (
      blanked[open] === "(" &&
      /\b(callCount|calls\.count|invocations\.count|timesCalled)\b/.test(blanked.slice(open, matching(blanked, open)))
    )
      callCountAssertions++;
  }
  const sleeps = [...blanked.matchAll(/\b(Task|Thread)\.sleep\s*\(|(?<![\w.])u?sleep\s*\(/g)].filter((match) =>
    fixedWait(blanked, match.index),
  ).length;
  // An inverted expectation passes only by waiting out its whole timeout.
  const invertedWaits = /\.isInverted\s*=\s*true/.test(blanked)
    ? count(blanked, /\bwait\s*\(\s*for\s*:|\bfulfillment\s*\(\s*of\s*:/g)
    : 0;
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
