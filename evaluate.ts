#!/usr/bin/env bun
/**
 * Judges commit messages, the code comments a commit adds, whether code files
 * are bloated or overengineered, tests, UI copy, READMEs, a commit history and
 * repo hygiene.
 *
 * Commits:
 *   bun evaluate.ts <repo> [--hash <sha>]          an existing commit (default HEAD)
 *   bun evaluate.ts <repo> --range <a>..<b>        every commit in a range
 *   bun evaluate.ts <repo> --staged -m "<message>" staged changes plus a proposed message
 *   bun evaluate.ts <repo> --staged --message-file <path>
 *   bun evaluate.ts <repo> --amend -m "<message>"   staged changes folded into HEAD, as git commit --amend does
 *   bun evaluate.ts <repo> --hash <sha> -m "<message>"  a reworded message for an existing commit
 *   Pass -m more than once to rank several drafts against the same diff.
 *   Add --check-files to also judge each changed code file for bloat, and any changed README.
 *
 * Files:
 *   bun evaluate.ts [<repo>] --file <path> [--file <path> ...]   code for bloat, tests for test quality, Markdown as READMEs
 *   bun evaluate.ts [<repo>] --tests <path>                       force the test-quality check on a file
 *   bun evaluate.ts [<repo>] --copy <path>                        judge a view's user-facing strings
 *   bun evaluate.ts <repo> --readme                              the README at the top of the repo
 *   Reads the working tree, or the version at --hash <sha>, or the staged one with --staged.
 *
 * Design specs and implementation plans (the superpowers brainstorming and writing-plans documents):
 *   bun evaluate.ts [<repo>] --design <spec.md>                   is the spec concrete, decided and scoped
 *   bun evaluate.ts [<repo>] --plan <plan.md>                     can each task be carried out, test first
 *   bun evaluate.ts [<repo>] --plan <plan.md> --design <spec.md>  also: does the plan cover the spec
 *   Repeat --plan when several plans implement one spec. Reads the working tree, --staged or --hash.
 *
 * Repo hygiene (no Jev, exact checks):
 *   bun evaluate.ts <repo> --repo-check       forbidden files and words, secrets, trailers, basics
 *   Add it to any other run to check the same working tree, staged files or commit too.
 *
 * History:
 *   bun evaluate.ts <repo> --history [--range <a>..<b>]   the commit history as a whole
 *
 * Project settings:
 *   --config <project.json>  context, README requirements, commit rules and hygiene lists in one file
 *                            (evaluator.json at the top of the repo is used when this is left off)
 *
 * Project context, for file and README checks:
 *   --context <spec.md>     what the project must do, so required design is not called bloat
 *   --require "<content>"   something the README must cover (repeatable)
 *   --require-file <path>   one requirement per line
 *
 * Flags: --json (machine-readable), --verbose (every Jev reading),
 *        --no-comments (skip comments), --tag <name> (label the run in the logs)
 *
 * Exit code: 0 pass, 1 fail (an error, or a bloated file), 2 bad usage or git error,
 * 3 crashed (logged to logs/errors-*.jsonl).
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { listFolder, mainCheckout, readCommit, readFileAt, readStaged, repoRootOf, type CommitInput } from "./src/git";
import { evaluate } from "./src/evaluate";
import { evaluateFile } from "./src/code-evaluate";
import { evaluateReadme, findReadme } from "./src/readme-evaluate";
import { failed, formatAny, type AnyEvaluation } from "./src/report";
import { evaluateHistory, type HistoryEvaluation } from "./src/history";
import { evaluateTests } from "./src/test-evaluate";
import { isTestFile } from "./src/test-parse";
import { evaluateCopy } from "./src/copy-evaluate";
import { logCrash } from "./src/log";
import { loadConfig, projectConfig, readLines, type ProjectConfig } from "./src/config";
import { evaluateHygiene, type HygieneEvaluation } from "./src/hygiene";
import { evaluateDesign, type DesignEvaluation } from "./src/design-evaluate";
import { evaluateCoverage, evaluatePlan, type CoverageEvaluation, type PlanEvaluation } from "./src/plan-evaluate";

loadEnv();
// A crash is logged with its arguments, so it can be reproduced from the logs alone.
for (const event of ["uncaughtException", "unhandledRejection"] as const) {
  process.on(event, (error: unknown) => {
    logCrash(error);
    console.error(`evaluator crashed: ${error instanceof Error ? (error.stack ?? error.message) : error}`);
    process.exit(3);
  });
}

const SHORT: Record<string, string> = { m: "message", F: "message-file", h: "help" };
let parsed: ReturnType<typeof parse>;
try {
  parsed = parse();
} catch (error) {
  fail(`${error instanceof Error ? error.message : error}\nRun with --help for usage.`);
}
const { values: options, positionals: positional } = parsed!;
const key = (name: string) => SHORT[name.replace(/^-+/, "")] ?? name.replace(/^-+/, "");
const flag = (name: string) => options[key(name) as keyof typeof options] === true;
// -m and --message are one option, so ask for each option once.
const all = (...names: string[]) =>
  [...new Set(names.map(key))].flatMap((name) => {
    const found = options[name as keyof typeof options];
    return typeof found === "string" ? [found] : Array.isArray(found) ? found : [];
  });
const value = (...names: string[]) => all(...names)[0];

// Unknown flags are an error, so a typo such as --check-file cannot silently skip a check.
function parse() {
  return parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      message: { type: "string", short: "m", multiple: true },
      "message-file": { type: "string", short: "F" },
      hash: { type: "string" },
      range: { type: "string" },
      staged: { type: "boolean" },
      amend: { type: "boolean" },
      "check-files": { type: "boolean" },
      file: { type: "string", multiple: true },
      readme: { type: "boolean" },
      context: { type: "string" },
      require: { type: "string", multiple: true },
      "require-file": { type: "string", multiple: true },
      "no-comments": { type: "boolean" },
      config: { type: "string" },
      "repo-check": { type: "boolean" },
      history: { type: "boolean" },
      tests: { type: "string", multiple: true },
      copy: { type: "string", multiple: true },
      design: { type: "string" },
      plan: { type: "string", multiple: true },
      json: { type: "boolean" },
      verbose: { type: "boolean" },
      tag: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
}

const files = [...all("--file"), ...all("--tests"), ...all("--copy")];
const designPath = value("--design");
const planPaths = all("--plan");
const docsAsked = Boolean(designPath || planPaths.length);
const repoArg = positional[0];
if (flag("--help") || flag("-h") || (!repoArg && !files.length && !docsAsked && !flag("--readme") && !flag("--repo-check") && !flag("--history"))) {
  console.error(readFileSync(import.meta.path, "utf8").split("*/")[0].replace(/^#!.*\n\/\*\*\n/, "").replace(/^ \* ?/gm, ""));
  process.exit(repoArg || files.length || docsAsked ? 0 : 2);
}

const tag = value("--tag");
const verbose = flag("--verbose");
const repoRoot = repoRootOf(resolve(repoArg ?? "."));
const config = loadProjectConfig(value("--config"), repoRoot);
const contextFile = value("--context");
const context = contextFile ? readInput(contextFile, "--context") : config.context;
// Flags win over the config file.
const listed = [...all("--require"), ...all("--require-file").flatMap((path) => readLines(readInput(path, "--require-file")))];
const requirements = listed.length ? listed : (config.readme?.require ?? []);
const rules = { forbidTrailers: config.commit?.forbidTrailers, maxChangedLines: config.commit?.maxChangedLines, forbiddenWords: config.hygiene?.forbiddenWords };
// Files are read from the index, a commit or the working tree. --amend reads the
// index for the hygiene check only; --file and --readme ignore it.
const fileRef = flag("--staged") ? "staged" : (value("--hash") ?? "worktree");
const ref = flag("--amend") ? "staged" : fileRef;

// The hygiene check runs beside whatever else was asked for.
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
    tag
  );
  const commitAsked = flag("--staged") || flag("--amend") || value("--hash") || value("--range") || all("-m").length || value("-F");
  if (!files.length && !docsAsked && !flag("--readme") && !commitAsked) finish([]);
}

// The whole commit history, or --range of it.
if (flag("--history")) {
  if (!repoRoot) fail(`${repoArg ?? "."} is not in a git repository`);
  let result: HistoryEvaluation;
  try {
    result = await evaluateHistory(repoRoot!, value("--range"), { ...rules, tag, ignore: config.ignore });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  finish([result!]);
}

// A design spec, one or more plans, and whether the plans between them cover the spec.
if (docsAsked) {
  const design = designPath ? readTarget(designPath) : undefined;
  const plans = planPaths.map(readTarget);
  const results: (DesignEvaluation | PlanEvaluation | CoverageEvaluation)[] = plans.length
    ? await Promise.all([...plans.map((plan) => evaluatePlan(plan, { tag })), ...(design ? [evaluateCoverage(plans, design, { tag })] : [])])
    : [await evaluateDesign(design!, { tag })];
  finish(results);
}

if (flag("--readme")) {
  const name = findReadme(repoRoot ? listFolder(repoRoot, ".", fileRef) : []);
  if (!repoRoot || !name) fail(`no README found at the top of ${repoArg ?? "."}`);
  files.push(join(repoRoot!, name!));
}

if (files.length) {
  const results = await Promise.all(
    files.map((path) => {
      const target = readTarget(path);
      if (all("--copy").includes(path)) return evaluateCopy(target, { tag, ...config.copy });
      if (isMarkdown(target.path)) return evaluateReadme(target, { tag, requirements });
      if (isTestFile(target.path, target.text) || all("--tests").includes(path)) return evaluateTests(target, { tag });
      return evaluateFile(target, { tag, context });
    })
  );
  finish(results);
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
  })
);
finish(results, () => {
  if (messages.length < 2) return;
  const ranked = [...results].sort((a, b) => Number(a.verdict === "fail") - Number(b.verdict === "fail") || b.score - a.score);
  console.log("\nDrafts ranked (passing first, then by score):");
  ranked.forEach((result, index) => console.log(`  ${index + 1}. ${result.verdict.toUpperCase()} ${String(result.score).padStart(3)}  ${result.message.split("\n")[0]}`));
});

function isMarkdown(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path) || findReadme([path.split("/").pop()!]) !== undefined;
}

// Prints the reports and the hygiene check, then exits 1 if anything failed.
function finish(results: AnyEvaluation[], after?: () => void): never {
  const all = hygiene ? [...results, hygiene] : results;
  if (flag("--json")) console.log(JSON.stringify(all.length === 1 ? all[0] : all, null, 2));
  else {
    console.log(all.map((result) => formatAny(result, verbose)).join("\n\n" + "─".repeat(60) + "\n\n"));
    after?.();
  }
  process.exit(all.some(failed) ? 1 : 0);
}

function loadProjectConfig(path: string | undefined, repoRoot: string | undefined): ProjectConfig {
  try {
    if (path) return loadConfig(path);
    return (repoRoot && projectConfig(repoRoot)) || {};
  } catch (error) {
    fail(`${path ? "--config" : "evaluator.json"}: ${error instanceof Error ? error.message : error}`);
  }
}

// A --file path is taken relative to <repo> when one is given, otherwise to
// the current folder. Its repo, when it has one, supplies the usage counts.
function readTarget(path: string): { path: string; text: string; repo?: string; ref: string; folder?: string } {
  const full = isAbsolute(path) ? path : resolve(repoArg ?? ".", path);
  if (existsSync(full) && statSync(full).isDirectory()) fail(`${path} is a folder; --file takes a file`);
  const root = repoRootOf(existsSync(full) ? dirname(full) : dirname(resolve(repoArg ?? ".")));
  if (!root) {
    if (fileRef !== "worktree") fail(`${path} is not in a git repository, so --hash and --staged do not apply`);
    if (!existsSync(full)) fail(`${path} does not exist`);
    return { path: basename(full), text: readFileSync(full, "utf8"), ref: fileRef, folder: dirname(full) };
  }
  const rel = relative(root, full);
  const text = readFileAt(root, rel, fileRef);
  if (text === undefined) fail(`${rel} does not exist ${fileRef === "worktree" ? "" : `at ${fileRef}`}`.trim());
  return { path: rel, text: text!, repo: root, ref: fileRef };
}

function readInput(path: string, flagName: string): string {
  if (!existsSync(path)) fail(`${flagName} ${path}: no such file`);
  return readFileSync(path, "utf8");
}

function fail(message: string): never {
  console.error(`evaluator: ${message}`);
  process.exit(2);
}

// Bun only reads .env from the working directory, and this is usually run from
// somewhere else. The live worktree has no .env of its own, so fall back to the
// main checkout's.
function loadEnv(): void {
  if (process.env.JEV_API_KEY) return;
  for (const dir of [import.meta.dir, mainCheckout(import.meta.dir) ?? ""]) {
    const path = join(dir, ".env");
    if (!dir || !existsSync(path)) continue;
    for (const row of readFileSync(path, "utf8").split("\n")) {
      const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/.exec(row);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
    return;
  }
}
