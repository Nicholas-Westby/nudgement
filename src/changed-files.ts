import { evaluateFile } from "./code-evaluate";
import { type FoundComment, findComments } from "./comments";
import type { Evaluation, Options } from "./commit-rules";
import { evaluateCopy } from "./copy-evaluate";
import { extractCopy } from "./copy-extract";
import { evaluateDesign } from "./design-evaluate";
import { type CommitInput, grepArgs } from "./git";
import { matchesPath } from "./hygiene";
import { evaluatePlan } from "./plan-evaluate";
import { planningDocKind } from "./plan-parse";
import { evaluateReadme, findReadme } from "./readme-evaluate";
import { evaluateTests } from "./test-evaluate";
import { isTestFile } from "./test-parse";

// Review whole files only when mostly new; otherwise limit findings to touched units.
const MOSTLY_NEW = 0.4;

export function checkChangedFiles(
  input: CommitInput,
  options: Options,
  textOf: (path: string) => string | undefined,
): Promise<Evaluation["files"]> {
  const { tag, context, requirements } = options;
  const { ref } = input;
  return Promise.all(
    input.files
      .filter(
        (file) =>
          !file.binary &&
          file.lines.some((line) => line.kind === "+") &&
          !(options.ignore ?? []).some((pattern) => matchesPath(file.path, pattern)),
      )
      .flatMap((file): Promise<Evaluation["files"][number]>[] => {
        const text = textOf(file.path);
        if (text === undefined) return [];

        const doc = planningDocKind(file.path);
        // Braces and blank lines alone do not introduce UI copy.
        const worded = (line: string) => /\p{L}/u.test(line);
        const touched = new Set(
          file.lines.filter((line) => line.kind === "+" && worded(line.text)).map((line) => line.newLine!),
        );
        if (!touched.size) return [];
        const whole = touched.size >= MOSTLY_NEW * text.split("\n").filter(worded).length;
        if (doc === "design")
          return [
            evaluateDesign(
              { path: file.path, text, repo: input.repo, ref },
              { tag, touched: whole ? undefined : touched },
            ),
          ];
        if (doc === "plan")
          return [
            evaluatePlan(
              { path: file.path, text, repo: input.repo, ref },
              { tag, touched: whole ? undefined : touched },
            ),
          ];
        if (findReadme([file.path.split("/").pop()!]))
          return [
            evaluateReadme(
              { path: file.path, text, repo: input.repo, ref },
              { tag, requirements, requirementsAsWarnings: true, touched: whole ? undefined : touched },
            ),
          ];
        // Tests get the test-quality check; bloat questions mostly misfire on them.
        if (isTestFile(file.path, text))
          return [
            evaluateTests(
              { path: file.path, text, repo: input.repo, ref },
              { tag, touched: whole ? undefined : touched },
            ),
          ];
        const bloat = evaluateFile(
          { path: file.path, text, repo: input.repo, ref },
          { tag, context, touched: whole ? undefined : touched, skipFileLevel: !whole },
        );
        // Swift models can hold UI messages too; review only strings on changed lines.
        const found = file.path.endsWith(".swift") ? extractCopy(file.path, text) : undefined;
        if (!/\.[jt]sx$/.test(file.path) && !found?.some((item) => whole || touched.has(item.line))) return [bloat];
        return [
          bloat,
          evaluateCopy(
            { path: file.path, text, repo: input.repo, ref, found },
            { tag, ...options.copy, touched: whole ? undefined : touched },
          ),
        ];
      }),
  );
}

export function collectComments(input: CommitInput, textOf: (path: string) => string | undefined): FoundComment[] {
  const found: FoundComment[] = [];
  for (const file of input.files) {
    if (!file.lines.some((line) => line.kind === "+")) continue;
    found.push(...findComments(file, textOf(file.path)?.split("\n")));
  }
  return withoutMachineRead(input.repo, input.ref, found);
}

// A comment led by a tag, such as "// no-help: text label visible".
const TAGGED = /^\s*(\/\/|#|--)\s*([\w-]+):/;

/** Exclude comment tags consumed by repository code, such as test exemptions. */
export function withoutMachineRead(repo: string, ref: string, comments: FoundComment[]): FoundComment[] {
  const read = new Map<string, boolean>();
  const isRead = (marker: string, tag: string) => {
    const key = `${marker} ${tag}`;
    if (!read.has(key)) {
      const result = Bun.spawnSync([
        "git",
        "-C",
        repo,
        "grep",
        "-q",
        "-F",
        "-e",
        `"${marker} ${tag}:`,
        "-e",
        `"${tag}:`,
        ...grepArgs(ref),
        "--",
        ".",
      ]);
      read.set(key, result.exitCode === 0);
    }
    return read.get(key)!;
  };
  return comments.filter((comment) => {
    const match = TAGGED.exec(comment.text);
    return !match || !isRead(match[1], match[2]);
  });
}
