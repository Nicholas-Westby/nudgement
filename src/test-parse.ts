import { findSwiftTests, matching, swiftTestFacts } from "./swift-tests";

/**
 * Finds the test cases in a Vitest, Jest or Playwright file, or a Swift file
 * (in swift-tests.ts), and counts what
 * code can count exactly: assertions, weak matchers, mocks, sleeps, CSS
 * selectors. Strings and comments are blanked out before searching, so text
 * that merely mentions test( is not taken for a test.
 */

export interface FoundTest {
  name: string;
  /** Such as "only", "skip", "todo", "each". */
  modifiers: string[];
  /** The describe blocks around the test, outermost first. */
  describe: string[];
  startLine: number;
  endLine: number;
  code: string;
  language: TestLanguage;
}

export type TestLanguage = "js" | "swift";

export const testLanguageOf = (path: string): TestLanguage => (path.endsWith(".swift") ? "swift" : "js");

export interface TestFacts {
  assertions: number;
  /** Assertions the typechecker enforces, such as expectTypeOf<T>(); they do nothing at run time. */
  typeAssertions: number;
  /** Assertions that only check truthiness, definedness, type or a snapshot. */
  weak: number;
  mocks: number;
  callCountAssertions: number;
  sleeps: number;
  cssSelectors: number;
  realClock: number;
}

// As the runners decide: Playwright and Cypress only run .test, .spec and .cy files,
// so helpers and setup files beside them are code; Jest runs everything in __tests__.
// Swift names no test files, so a Swift file counts only when it holds tests:
// fakes and fixtures beside them are code.
export function isTestFile(path: string, text?: string): boolean {
  if (testLanguageOf(path) === "swift") return /(^|\/)(tests?|\w*Tests?)\/|Tests?\.swift$/.test(path) && text !== undefined && findSwiftTests(text).length > 0;
  return /[._](test|spec|cy)\.[cm]?[jt]sx?$/.test(path) || /(^|\/)__tests__\//.test(path);
}

/** Whether the file asks its runner to run its tests in order, as a story that builds on itself. */
export function declaresSerialOrder(text: string): boolean {
  return /\.describe\.configure\(\s*\{[^}]*mode:\s*["']serial["']|\.describe\.serial\s*\(/.test(text);
}

/** The source with every string, template literal and comment replaced by spaces, keeping offsets. */
function blank(source: string): string {
  const out = source.split("");
  let i = 0;
  const fill = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      fill(i, end < 0 ? source.length : end);
      i = end < 0 ? source.length : end;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      fill(i, end < 0 ? source.length : end + 2);
      i = end < 0 ? source.length : end + 2;
    } else if (char === '"' || char === "'" || char === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== char) {
        if (source[j] === "\\") j++;
        else if (char !== "`" && source[j] === "\n") break;
        j++;
      }
      // Keep the quotes so a string argument can still be found.
      fill(i + 1, j);
      i = j + 1;
    } else i++;
  }
  return out.join("");
}

const NOT_TESTS = new Set(["beforeEach", "afterEach", "beforeAll", "afterAll", "step", "use", "extend", "setTimeout", "info", "configure"]);

const lineAt = (source: string, offset: number) => source.slice(0, offset).split("\n").length;

/** Every test() and it() in the file, or every Swift test when the path is a Swift file, in source order. */
export function findTests(source: string, path = ""): FoundTest[] {
  if (testLanguageOf(path) === "swift") return findSwiftTests(source);
  const blanked = blank(source);
  const found: FoundTest[] = [];
  const describes: { name: string; end: number }[] = [];
  const call = /(?<![\w$.])(describe|test|it)\b/g;
  let match: RegExpExecArray | null;
  while ((match = call.exec(blanked))) {
    let i = match.index + match[1].length;
    const modifiers: string[] = [];
    let isDescribe = match[1] === "describe";
    // Chains such as test.only, it.skip, test.describe, test.each([...]).
    while (blanked[i] === ".") {
      const word = /^\.(\w+)/.exec(blanked.slice(i))?.[1];
      if (!word) break;
      i += word.length + 1;
      if (word === "describe") isDescribe = true;
      else modifiers.push(word);
      while (blanked[i] === " ") i++;
      if (["each", "for"].includes(word) && blanked[i] === "(") i = matching(blanked, i) + 1;
    }
    while (blanked[i] === " ") i++;
    if (blanked[i] !== "(") continue;
    // Hooks and steps are not tests: test.beforeEach(...), test.step(...).
    if (modifiers.some((modifier) => NOT_TESTS.has(modifier))) continue;
    const open = i;
    const close = matching(blanked, open);
    let j = open + 1;
    while (/\s/.test(source[j])) j++;
    let name = "(computed name)";
    if (["'", '"', "`"].includes(source[j])) {
      const quote = source[j];
      let k = j + 1;
      while (k < source.length && source[k] !== quote) k += source[k] === "\\" ? 2 : 1;
      name = source.slice(j + 1, k);
    }
    while (describes.length && describes.at(-1)!.end < match.index) describes.pop();
    if (isDescribe) {
      describes.push({ name, end: close });
      continue;
    }
    found.push({
      name,
      modifiers,
      describe: describes.map((d) => d.name),
      startLine: lineAt(source, match.index),
      endLine: lineAt(source, close),
      code: source.slice(match.index, close + 1),
      language: "js",
    });
    // Skip past the body, so a test inside a test is not counted twice.
    call.lastIndex = close;
  }
  return found;
}

const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

export function testFacts(code: string, language: TestLanguage = "js"): TestFacts {
  if (language === "swift") return swiftTestFacts(code);
  const blanked = blank(code);
  return {
    // Shared helpers such as expectNotFoundPage(page), and expectTypeOf<T>(), hold their own assertions.
    assertions: count(blanked, /\bexpect(\s*\.soft|\s*\.poll)?\s*\(|\bassert(\.\w+)?\s*\(|\b(expect|assert)[A-Z_]\w*\s*(<[^()]*>)?\s*\(/g),
    typeAssertions: count(blanked, /\bexpectTypeOf\b|\bassertType\s*(<[^()]*>)?\s*\(/g),
    weak: count(
      blanked,
      /\.(toBeTruthy|toBeFalsy|toBeDefined|toBeInstanceOf|toMatchSnapshot|toMatchInlineSnapshot)\s*\(|\.not\.toBeNull\s*\(|\.toBeGreaterThan\s*\(\s*0\s*\)/g
    ),
    mocks: count(blanked, /\b(vi|jest)\.(mock|fn|spyOn|doMock)\s*\(|\.mock(Return|Resolved|Rejected|Implementation)\w*\s*\(/g),
    callCountAssertions: count(blanked, /\.toHaveBeenCalled(Times|With)?\s*\(|\.toHaveBeenNthCalledWith\s*\(|\.toHaveBeenLastCalledWith\s*\(/g),
    sleeps: count(blanked, /\b(setTimeout|waitForTimeout|sleep)\s*\(/g),
    cssSelectors: count(code, /\b(locator|\$\$?|querySelector(All)?)\s*\(\s*['"`]\s*([.#]|xpath=|\/\/|\[class)/g),
    realClock: count(blanked, /\bnew Date\s*\(\s*\)|\bDate\.now\s*\(/g),
  };
}
