#!/usr/bin/env bun
import { join, resolve } from "node:path";
import { fail, loadEnv, loadProjectConfig, readInput, readTarget } from "./src/cli-files";
import { HELP } from "./src/cli-help";
import { all, flag, positional, value } from "./src/cli-options";
import { finish } from "./src/cli-output";
import { evaluateFile } from "./src/code-evaluate";
import { readLines } from "./src/config";
import { evaluateCopy } from "./src/copy-evaluate";
import { type DesignEvaluation, evaluateDesign } from "./src/design-evaluate";
import { evaluate } from "./src/evaluate";
import { type CommitInput, listFolder, readCommit, readStaged, repoRootOf } from "./src/git";
import { evaluateHistory, type HistoryEvaluation } from "./src/history";
import { evaluateHygiene, type HygieneEvaluation } from "./src/hygiene";
import { logCrash } from "./src/log";
import { type CoverageEvaluation, evaluateCoverage, evaluatePlan, type PlanEvaluation } from "./src/plan-evaluate";
import { evaluateReadme, findReadme } from "./src/readme-evaluate";
import { evaluateTests } from "./src/test-evaluate";
import { isTestFile } from "./src/test-parse";

loadEnv();

for (const event of ["uncaughtException", "unhandledRejection"] as const) {
  process.on(event, (error: unknown) => {
    logCrash(error);
    console.error(`nudgement crashed: ${error instanceof Error ? (error.stack ?? error.message) : error}`);
    process.exit(3);
  });
}

const files = [...all("--file"), ...all("--tests"), ...all("--copy")];
const designPath = value("--design");
const planPaths = all("--plan");
const docsAsked = Boolean(designPath || planPaths.length);
const repoArg = positional[0];
if (
  flag("--help") ||
  (!repoArg && !files.length && !docsAsked && !flag("--readme") && !flag("--repo-check") && !flag("--history"))
) {
  console.error(HELP);
  process.exit(flag("--help") ? 0 : 2);
}

const tag = value("--tag");

const verbose = flag("--verbose");

const repoRoot = repoRootOf(resolve(repoArg ?? "."));

const config = loadProjectConfig(value("--config"), repoRoot);

const contextFile = value("--context");

const context = contextFile ? readInput(contextFile, "--context") : config.context;

const listed = [
  ...all("--require"),
  ...all("--require-file").flatMap((path) => readLines(readInput(path, "--require-file"))),
];

const requirements = listed.length ? listed : (config.readme?.require ?? []);

const rules = {
  forbidTrailers: config.commit?.forbidTrailers,
  maxChangedLines: config.commit?.maxChangedLines,
  forbiddenWords: config.hygiene?.forbiddenWords,
};

// Files are read from the index, a commit or the working tree. --amend reads the
// index for the hygiene check only; --file and --readme ignore it.
const fileRef = flag("--staged") ? "staged" : (value("--hash") ?? "worktree");

const ref = flag("--amend") ? "staged" : fileRef;

let hygiene: HygieneEvaluation | undefined;
if (flag("--repo-check")) {
  if (!repoRoot) fail(`${repoArg ?? "."} is not in a git repository, so --repo-check does not apply`);
  hygiene = evaluateHygiene(
    repoRoot!,
    ref,
    {
      forbiddenPaths: config.hygiene?.forbiddenPaths,
      forbiddenWords: config.hygiene?.forbiddenWords,
      forbidTrailers: config.commit?.forbidTrailers,
      maxFileKb: config.hygiene?.maxFileKb,
      ignorePaths: [...(config.ignore ?? []), ...(config.hygiene?.ignore ?? [])],
    },
    tag,
  );
  const commitAsked =
    flag("--staged") || flag("--amend") || value("--hash") || value("--range") || all("-m").length || value("-F");
  if (!files.length && !docsAsked && !flag("--readme") && !commitAsked) finish([], flag("--json"), verbose, hygiene);
}

if (flag("--history")) {
  if (!repoRoot) fail(`${repoArg ?? "."} is not in a git repository`);
  let result: HistoryEvaluation;
  try {
    result = await evaluateHistory(repoRoot!, value("--range"), { ...rules, tag, ignore: config.ignore });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  finish([result!], flag("--json"), verbose, hygiene);
}

if (docsAsked) {
  const design = designPath ? readTarget(designPath, repoArg, fileRef) : undefined;
  const plans = planPaths.map((path) => readTarget(path, repoArg, fileRef));
  const results: (DesignEvaluation | PlanEvaluation | CoverageEvaluation)[] = plans.length
    ? await Promise.all([
        ...plans.map((plan) => evaluatePlan(plan, { tag })),
        ...(design ? [evaluateCoverage(plans, design, { tag })] : []),
      ])
    : [await evaluateDesign(design!, { tag })];
  finish(results, flag("--json"), verbose, hygiene);
}

if (flag("--readme")) {
  const name = findReadme(repoRoot ? listFolder(repoRoot, ".", fileRef) : []);
  if (!repoRoot || !name) fail(`no README found at the top of ${repoArg ?? "."}`);
  files.push(join(repoRoot!, name!));
}

if (files.length) {
  const results = await Promise.all(
    files.map((path) => {
      const target = readTarget(path, repoArg, fileRef);
      if (all("--copy").includes(path)) return evaluateCopy(target, { tag, ...config.copy });
      if (isMarkdown(target.path)) return evaluateReadme(target, { tag, requirements });
      if (isTestFile(target.path, target.text) || all("--tests").includes(path)) return evaluateTests(target, { tag });
      return evaluateFile(target, { tag, context });
    }),
  );
  finish(results, flag("--json"), verbose, hygiene);
}

const messages = all("-m", "--message");

const messageFile = value("--message-file", "-F");

if (messageFile) messages.push(readInput(messageFile, "--message-file"));

const inputs: CommitInput[] = [];

try {
  const repoPath = resolve(repoArg!);
  if (flag("--staged") || flag("--amend")) {
    if (!messages.length) throw new Error('--staged needs the proposed message: -m "..." or --message-file <path>');
    for (const draft of messages) inputs.push(readStaged(repoPath, draft, { amend: flag("--amend") }));
  } else if (value("--range")) {
    const list = Bun.spawnSync(["git", "-C", repoPath, "rev-list", "--reverse", "--no-merges", value("--range")!]);
    if (list.exitCode !== 0) throw new Error(list.stderr.toString());
    for (const sha of list.stdout.toString().trim().split("\n").filter(Boolean)) inputs.push(readCommit(repoPath, sha));
  } else {
    const hash = value("--hash") ?? "HEAD";
    if (messages.length > 1) for (const draft of messages) inputs.push(readCommit(repoPath, hash, draft));
    else inputs.push(readCommit(repoPath, hash, messages[0]));
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

// Drafts share one diff, so its comments and files only need judging once.
const results = await Promise.all(
  inputs.map((input, index) => {
    const first = messages.length < 2 || index === 0;
    return evaluate(input, {
      comments: !flag("--no-comments") && first,
      checkFiles: flag("--check-files") && first,
      tag,
      context,
      requirements,
      rules,
      copy: config.copy,
      ignore: config.ignore,
    });
  }),
);

finish(results, flag("--json"), verbose, hygiene, () => {
  if (messages.length < 2) return;
  const ranked = [...results].sort(
    (a, b) => Number(a.verdict === "fail") - Number(b.verdict === "fail") || b.score - a.score,
  );
  console.log("\nDrafts ranked (passing first, then by score):");
  ranked.forEach((result, index) => {
    console.log(
      `  ${index + 1}. ${result.verdict.toUpperCase()} ${String(result.score).padStart(3)}  ${result.message.split("\n")[0]}`,
    );
  });
});

function isMarkdown(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path) || findReadme([path.split("/").pop()!]) !== undefined;
}
