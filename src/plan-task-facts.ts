import type { PlanTask, TaskFacts } from "./plan-parse";
import { codeLines, FENCE, LIST_ITEM, withoutInlineCode } from "./spec-parse";

const FILE_EXTENSIONS =
  "swift|ts|tsx|js|jsx|mjs|cjs|json|jsonc|json5|md|mdx|py|rb|go|rs|java|kt|kts|c|h|cc|cpp|hpp|m|mm|sh|bash|zsh|sql|css|scss|sass|less|html|htm|yml|yaml|toml|xml|plist|txt|csv|svg|png|jpg|jpeg|webp|gif|ico|ics|env|lock|gradle|xcconfig|entitlements|strings|xcstrings|storyboard|xib|vue|svelte|dart|php|cs|fs|ex|exs|erl|zig|lua|pl|r|jl|scala|clj|tf|proto|graphql|gql|ini|cfg|conf|rst|adoc|woff2|woff|pbxproj";

const FILE_PATH = new RegExp(`^[\\w@~.*/\\[\\]-]*\\.(?:${FILE_EXTENSIONS})(?::\\d+(?:-\\d+)?)?$`, "i");

export const FILES_LABEL = /^\s*(?:[-*]\s*)?(?:\*\*)?Files?(?:\*\*)?:?(?:\*\*)?:?(\s|$)/i;

const STEP = /^\s*[-*]\s*\[[ xX]\]|\bStep\s+\d/i;

const TEST_STEP =
  /\b(failing tests?|(write|add) (the |a |some )?(failing )?(unit |integration |ui |e2e |end-to-end |property )?tests?|tests? first|see (it|them) fail)\b/i;

// A line that names a test tersely: "Tests: `XTests`", "Pixel test (...)", "Update `XTests`", "red first".
const TEST_LINE =
  /^\s*(?:[-*]\s*)?(?:(?:unit|pixel|ui|snapshot|property)\s+)?tests?\b\s*[:(`]|`\w+Tests?`|\bpixel tests?\b|\bred first\b|\bTest:|\bupdate\b[^.]*\btests\b/i;

// Red/green steps: "- [ ] Red: a deleted recipe round-trips…", then "- [ ] Green: add the record".
const RED_STEP = /^\s*[-*]\s*\[[ xX]\]\s*(?:\*\*)?Red\b/;

const GREEN_STEP = /^\s*[-*]\s*\[[ xX]\]\s*(?:\*\*)?Green\b/;

const TEST_FILE = /\bTests?:\s*`|`[^`\s]*(Tests?|Tests?\.\w+|Spec|\.(test|spec)\.\w+|_test\.\w+)`/;

// A type or suite name given alone in a Files block, such as `LedgerImportTests`.
const TYPE_NAME = /^[A-Z][A-Za-z0-9]+$/;

const HAND_CHECK_TITLE = /\b(live check|spike|milestone|smoke test|screenshots?|measure)\b/i;

const VERIFY_STEP =
  /\b(prove|verify|check|build it|look at it|run|measure|smoke|live (check|run)|screenshot|confirm|deploy)\b/i;

const TEST_CODE =
  /@Test\b|\bfunc test\w*\s*\(|\b(it|test|describe)\s*\(\s*["'`]|\bdef test_\w+|#\[test\]|XCTAssert|#expect\s*\(|\bexpect\s*\(|\bassert(Equal|That|True)?\s*\(|t\.Run\(/;

const IMPLEMENT = /\b(implement|minimal (code|implementation)|write the code|port)\b/i;

const RUNNER =
  /^(\.\/[\w./-]+|npx |npm |pnpm |yarn |bun |bunx |swift |xcodebuild |pytest|python3? |go (test|run|build)|cargo |make\b|deno |node |vitest|jest|mvn |gradle|\.\/gradlew|dotnet |mix |rspec|bundle exec|rake |bash |sh |xcrun |tuist |wrangler )/;

const NO_TEST =
  /\bno (unit |automated )?tests? (for|in|here|is needed|needed)\b|\bnothing (here )?to (unit[- ])?test\b|\bnot (unit[- ])?testable\b|\bwithout a (unit )?test\b/i;

const EXPECTED =
  /\bexpect(ed|s)?\b|\b(fail|fails|failing|pass|passes|passing|green|red)\b|\bprints?\b|\bexits?\b|\boutput\b/i;

export function taskFacts(task: PlanTask): TaskFacts {
  const lines = task.text.split("\n");
  const inCode = codeLines(lines);

  const files: string[] = [];
  const block = filesBlock(lines, inCode);
  const add = (span: string) => {
    const path = span.trim().replace(/:\d+(-\d+)?$/, "");
    const looksLikeFile =
      FILE_PATH.test(span.trim()) || (path.includes("/") && !/^https?:/.test(path)) || TYPE_NAME.test(path);
    if (!/\s/.test(path) && looksLikeFile && !files.includes(path)) files.push(path);
  };
  for (const index of block ?? lines.map((_, i) => i).filter((i) => !inCode[i])) {
    for (const match of lines[index].matchAll(/`([^`]+)`/g)) {
      if (block || FILE_PATH.test(match[1].trim()) || TYPE_NAME.test(match[1].trim())) add(match[1]);
    }
  }

  let testLine = Infinity;
  let implementLine = Infinity;
  lines.forEach((line, index) => {
    if (inCode[index]) {
      if (FENCE.test(line) && index < testLine) {
        const end = lines.findIndex((l, i) => i > index && inCode[i] && FENCE.test(l));
        if (TEST_CODE.test(lines.slice(index + 1, end < 0 ? undefined : end).join("\n")))
          testLine = Math.min(testLine, index);
      }
      return;
    }
    const prose = withoutInlineCode(line);
    if (
      TEST_STEP.test(prose) ||
      RED_STEP.test(line) ||
      TEST_LINE.test(line) ||
      (block?.includes(index) && TEST_FILE.test(line))
    )
      testLine = Math.min(testLine, index);
    if ((STEP.test(line) && IMPLEMENT.test(prose) && !TEST_STEP.test(prose)) || GREEN_STEP.test(line))
      implementLine = Math.min(implementLine, index);
  });
  const noTestExplained = lines.some((line, index) => !inCode[index] && NO_TEST.test(line));
  // Saying there is no test outweighs a test suite named in passing.
  const test = testLine === Infinity || noTestExplained ? "none" : testLine < implementLine ? "before" : "after";

  let command: string | undefined;
  for (const [index, line] of lines.entries()) {
    if (inCode[index]) {
      if (!command && !FENCE.test(line) && RUNNER.test(line.trim().replace(/^\$\s*/, "")) && !/^\s*#/.test(line))
        command = line.trim().replace(/^\$\s*/, "");
      continue;
    }
    const spans = [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim());
    const run = /\bRun:?\s*`([^`]+)`/.exec(line)?.[1] ?? spans.find((span) => RUNNER.test(span));
    if (run && (STEP.test(line) || /\bRun\b/.test(line))) {
      command = run.trim();
      break;
    }
  }
  const expected = lines.some(
    (line, index) =>
      !inCode[index] &&
      EXPECTED.test(withoutInlineCode(line)) &&
      (STEP.test(line) || /^\s*(Expected|Run)\b/i.test(line)),
  );
  const verified =
    HAND_CHECK_TITLE.test(task.title) ||
    lines.some(
      (line, index) =>
        !inCode[index] &&
        ((STEP.test(line) && (VERIFY_STEP.test(withoutInlineCode(line)) || runsCommand(line))) ||
          /\blive check\b/i.test(line)),
    );
  return { files, test, command, expected, noTestExplained, verified };
}

// Line indexes covering the Files label and its following list.
function filesBlock(lines: string[], inCode: boolean[]): number[] | undefined {
  const start = lines.findIndex((line, index) => !inCode[index] && FILES_LABEL.test(line));
  if (start < 0) return undefined;
  const block = [start];
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index];
    if (inCode[index]) break;
    if (!line.trim()) {
      const next = lines.slice(index + 1).find((l) => l.trim());
      if (next && LIST_ITEM.test(next) && !STEP.test(next)) continue;
      break;
    }
    if (STEP.test(line) || /^\s*\*\*[^*]+:\*\*/.test(line) || /^#/.test(line)) break;
    block.push(index);
  }
  return block;
}

// A step that names a runner in backticks, such as "Full `./Scripts/test.sh`", runs a check.
function runsCommand(line: string): boolean {
  return [...line.matchAll(/`([^`]+)`/g)].some((match) => RUNNER.test(match[1].trim()));
}
