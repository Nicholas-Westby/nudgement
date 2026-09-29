import { blankSwift, lineAt, matching } from "./swift-mask";
import type { FoundTest } from "./test-parse";

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
  const token =
    /@(Suite|Test)\b|\b(struct|class|actor|enum|extension)\s+(?!(func|var|let|init|subscript)\b)(\w+)|\bfunc\s+(`[^`\n]+`|\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(blanked))) {
    while (scopes.length && scopes.at(-1)!.end < match.index) scopes.pop();
    const after = match.index + match[0].length;
    const args = /^\s*\(/.exec(blanked.slice(after));
    const argsOpen = args ? after + args[0].length - 1 : -1;
    const argsClose = args ? matching(blanked, argsOpen) : -1;
    const argsText = args ? blanked.slice(argsOpen, argsClose + 1) : "";
    if (match[1] === "Suite") {
      suite = {
        name: args ? displayName(source, blanked, argsOpen, argsClose) : undefined,
        disabled: /\.disabled\s*\(/.test(argsText),
      };
    } else if (match[1] === "Test") {
      const modifiers: string[] = [];
      if (/\.disabled\s*\(/.test(argsText)) modifiers.push("skip");
      if (/\barguments\s*:/.test(argsText)) modifiers.push("arguments");
      pending = {
        start: match.index,
        name: args ? displayName(source, blanked, argsOpen, argsClose) : undefined,
        modifiers,
      };
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
      // Recognize conventional XCTest method names with empty parameter lists.
      const xcMethod =
        !test &&
        xctest &&
        XCTEST_METHOD.test(name) &&
        !blanked.slice(paramsOpen + 1, paramsClose).trim() &&
        scopes.length > 0;
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
export { matching } from "./swift-mask";

export { swiftTestFacts } from "./swift-test-facts";
