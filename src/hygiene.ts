/**
 * Repo hygiene: what must never be committed, checked exactly in code. Files
 * that should stay out (planning notes, secrets, build output), words that
 * should appear nowhere, trailers the house style forbids, and a few things a
 * reviewer notices at once: no README, no .gitignore, no lockfile.
 *
 * `ref` is "worktree" (everything `git add -A` would commit), "staged", or a
 * commit.
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { isBloatCandidate } from "./code";
import { grepArgs, grepPath } from "./git";
import { evaluatorVersion, logRun, newRunId } from "./log";
import { parseMessage, sortIssues, type Issue, type Severity } from "./message";

export interface HygieneOptions {
  /** "dir/" matches anything under dir; otherwise a glob on the name, or on the path when it has a slash. */
  forbiddenPaths?: string[];
  forbiddenWords?: string[];
  forbidTrailers?: boolean;
  maxFileKb?: number;
  /** Paths left out of every check, such as test fixtures that hold fake secrets on purpose. */
  ignorePaths?: string[];
}

export interface HygieneResult {
  issues: Issue[];
  files: number;
}

const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs|e2e|fixtures?|mocks?)\/|\.(test|spec)\.\w+$/;

// Never wanted in a repo, whatever the project.
const ALWAYS_FORBIDDEN = ["node_modules/", ".DS_Store", ".env", ".env.local", ".env.*.local", ".dev.vars", ".wrangler/", "coverage/", "*.log", "*.sqlite", "*.sqlite3"];

const SECRETS: [string, RegExp][] = [
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["an AWS access key", /AKIA[0-9A-Z]{16}/],
  ["an API key", /\b(sk-[A-Za-z0-9_-]{20,}|apikey_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{35})/],
  ["a GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36}/],
  ["a Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
];

const SECRET_PREFIXES = ["PRIVATE KEY-----", "AKIA", "sk-", "apikey_", "AIza", "ghp_", "gho_", "ghu_", "ghs_", "ghr_", "xoxa-", "xoxb-", "xoxp-", "xoxr-", "xoxs-"];

// A fake key in a test is spelled out in lowercase words, such as sk-do-not-log-me;
// a real one is random, so it has capitals even where a stretch of it reads as words.
const WORDY = /(^|[-_])[a-z]+[-_][a-z]+[-_][a-z]+([-_]|$)/;

/** The kind of secret a line holds, if any. */
export function secretKind(text: string): string | undefined {
  for (const [name, pattern] of SECRETS) {
    const match = pattern.exec(text);
    if (match && !(WORDY.test(match[0]) && !/[A-Z]/.test(match[0].slice(4)))) return name;
  }
}


function git(repo: string, args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" });
  return result.stdout.toString();
}

/** Every file that is, or would be, committed at `ref`. */
function filesAt(repo: string, ref: string): string[] {
  const args =
    ref === "worktree" ? ["ls-files", "--cached", "--others", "--exclude-standard"] : ref === "staged" ? ["ls-files", "--cached"] : ["ls-tree", "-r", "--name-only", ref];
  const deleted = ref === "worktree" ? new Set(git(repo, ["ls-files", "--deleted"]).split("\n").filter(Boolean)) : new Set<string>();
  return [...new Set(git(repo, args).split("\n").filter((path) => path && !deleted.has(path)))];
}

/** Git repositories inside the repo that are, or would be, committed as bare links, with no .gitmodules entry to say where they come from. */
function nestedRepos(repo: string, ref: string, files: string[]): string[] {
  const listing = ref === "worktree" || ref === "staged" ? git(repo, ["ls-files", "-s"]) : git(repo, ["ls-tree", "-r", ref]);
  const links = listing.split("\n").filter((row) => row.startsWith("160000 ")).map((row) => row.split("\t")[1]);
  // Untracked, git lists a nested repository as its folder, with a slash.
  const untracked = ref === "worktree" ? files.filter((path) => path.endsWith("/")).map((path) => path.slice(0, -1)) : [];
  const modules = git(repo, ["show", `${ref === "worktree" || ref === "staged" ? "" : ref}:.gitmodules`]);
  return [...new Set([...links, ...untracked])].filter((path) => !modules.includes(`path = ${path}\n`));
}

/** Lines matching any pattern, as { path, line, text }, from git grep at `ref`. */
function grep(repo: string, ref: string, patterns: string[], flags: string[]): { path: string; line: number; text: string }[] {
  if (!patterns.length) return [];
  const output = git(repo, ["grep", "-I", "-n", ...flags, ...patterns.flatMap((pattern) => ["-e", pattern]), ...grepArgs(ref), "--", "."]);
  return output
    .split("\n")
    .filter(Boolean)
    .flatMap((row) => {
      const match = /^(.*?):(\d+):(.*)$/.exec(grepPath(row, ref));
      return match ? [{ path: match[1], line: Number(match[2]), text: match[3] }] : [];
    });
}

const globs = new Map<string, RegExp>();

function globToRegex(glob: string): RegExp {
  const cached = globs.get(glob);
  if (cached) return cached;
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*");
  const regex = new RegExp(`^${escaped}$`, "i");
  globs.set(glob, regex);
  return regex;
}

export function matchesPath(path: string, pattern: string): boolean {
  if (pattern.endsWith("/")) {
    const dir = pattern.slice(0, -1);
    return path.startsWith(`${dir}/`) || path.includes(`/${dir}/`);
  }
  if (pattern.includes("/")) return globToRegex(pattern).test(path);
  return globToRegex(pattern).test(path.split("/").pop()!);
}

const where = (hits: { path: string; line: number }[], limit = 5) =>
  hits
    .slice(0, limit)
    .map((hit) => `${hit.path}:${hit.line}`)
    .join(", ") + (hits.length > limit ? ` and ${hits.length - limit} more` : "");

export function checkHygiene(repo: string, ref: string, options: HygieneOptions): HygieneResult {
  const issues: Issue[] = [];
  const add = (severity: Severity, part: string, message: string, rule: string) => issues.push({ severity, part, message, source: `hygiene:${rule}` });
  const ignored = (path: string) => (options.ignorePaths ?? []).some((pattern) => matchesPath(path, pattern));
  const files = filesAt(repo, ref).filter((path) => !ignored(path));
  const grepAt = (patterns: string[], flags: string[]) => grep(repo, ref, patterns, flags).filter((hit) => !ignored(hit.path));
  let messages: { sha: string; message: string }[] | undefined;
  const history = () => (messages ??= commitMessages(repo, ref));

  // Files that must not be committed. An example env file is fine.
  const patterns = [...ALWAYS_FORBIDDEN, ...(options.forbiddenPaths ?? [])];
  const forbidden = files.filter((path) => !/\.(example|sample|template)$/.test(path) && patterns.some((pattern) => matchesPath(path, pattern)));
  if (forbidden.length) {
    const shown = forbidden.slice(0, 8).join(", ") + (forbidden.length > 8 ? ` and ${forbidden.length - 8} more` : "");
    add("error", "forbidden path", `These must not be committed: ${shown}. Remove them and add them to .gitignore.`, "forbidden-path");
  }
  const nested = nestedRepos(repo, ref, files);
  if (nested.length) add("error", "nested repo", `${nested.join(", ")} is a git repository of its own, such as a worktree; it would be committed as a bare link. Add it to .gitignore.`, "nested-repo");

  // Words that must appear nowhere: in file contents, file names, or commit messages.
  const words = options.forbiddenWords ?? [];
  if (words.length) {
    const hits = grepAt(words, ["-i", "-w", "-F"]);
    const patterns = new Map(words.map((word) => [word, new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")]));
    for (const word of words) {
      const found = hits.filter((hit) => patterns.get(word)!.test(hit.text));
      const named = files.filter((path) => path.toLowerCase().includes(word.toLowerCase()));
      if (found.length) add("error", "forbidden word", `"${word}" appears in ${where(found)}.`, "forbidden-word");
      if (named.length) add("error", "forbidden word", `"${word}" is in the file name ${named.slice(0, 5).join(", ")}.`, "forbidden-word");
    }
    // Branch and tag names are published with the repo too.
    const refs = git(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/tags"]).split("\n").filter(Boolean);
    for (const word of words) {
      const named = refs.filter((name) => name.toLowerCase().includes(word.toLowerCase()));
      if (named.length) add("error", "forbidden word", `"${word}" is in the branch or tag name ${named.join(", ")}.`, "forbidden-word");
    }
    for (const word of words) {
      const commits = history().filter((commit) => patterns.get(word)!.test(commit.message));
      if (commits.length) add("error", "forbidden word", `"${word}" appears in the message of commit ${commits.map((commit) => commit.sha).slice(0, 5).join(", ")}.`, "forbidden-word");
    }
  }

  if (options.forbidTrailers) {
    const withTrailers = history().filter((commit) => parseMessage(commit.message).trailers.length);
    if (withTrailers.length) {
      add("error", "trailers", `${withTrailers.length} commit(s) end with trailer lines, which this repo does not use: ${withTrailers.map((commit) => commit.sha).slice(0, 8).join(", ")}.`, "trailers");
    }
  }

  // Secrets. git grep finds the fixed prefixes (its -E on macOS has no \b), the
  // patterns then decide. The location is reported, never the value.
  const secretHits = grepAt(SECRET_PREFIXES, ["-F"]);
  for (const [name] of SECRETS) {
    const found = secretHits.filter((hit) => secretKind(hit.text) === name);
    if (found.length) add("error", "secret", `Something that looks like ${name} is in ${where(found)}. Remove it and rotate it.`, "secret");
  }

  const names = new Set(files.map((path) => path.toLowerCase()));
  if (![...names].some((path) => /^readme(\.\w+)?$/.test(path))) add("error", "readme", "There is no README at the top of the repo.", "no-readme");
  if (!names.has(".gitignore")) add("warn", "gitignore", "There is no .gitignore.", "no-gitignore");
  if (names.has("package.json") && !["package-lock.json", "bun.lock", "bun.lockb", "pnpm-lock.yaml", "yarn.lock"].some((lock) => names.has(lock))) {
    add("warn", "lockfile", "package.json has no lockfile beside it, so installs are not reproducible.", "no-lockfile");
  }

  const maxBytes = (options.maxFileKb ?? 500) * 1024;
  const large = sizes(repo, ref, files).filter(([, size]) => size > maxBytes);
  if (large.length) {
    add("warn", "large file", `Large files: ${large.slice(0, 5).map(([path, size]) => `${path} (${Math.round(size / 1024)} KB)`).join(", ")}.`, "large-file");
  }

  // Program source in any language, leaving out tests and fixtures.
  const source = (hit: { path: string }) => isBloatCandidate(hit.path) && !TEST_PATH.test(hit.path);
  const todos = grepAt(["TODO", "FIXME", "XXX"], ["-w", "-F"]).filter(source);
  if (todos.length) add("info", "todo", `${todos.length} TODO or FIXME note(s) in source: ${where(todos, 3)}.`, "todo");

  return { issues: sortIssues(issues), files: files.length };
}

function commitMessages(repo: string, ref: string): { sha: string; message: string }[] {
  const head = ref === "worktree" || ref === "staged" ? "HEAD" : ref;
  const hasHead = Bun.spawnSync(["git", "-C", repo, "rev-parse", "--verify", "-q", head]).exitCode === 0;
  if (!hasHead) return [];
  return git(repo, ["log", "--format=%h%x00%B%x01", head])
    .split("\u0001")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, message] = entry.split("\u0000");
      return { sha, message: message.trim() };
    });
}

function sizes(repo: string, ref: string, files: string[]): [string, number][] {
  if (ref !== "worktree" && ref !== "staged") {
    return git(repo, ["ls-tree", "-r", "-l", ref])
      .split("\n")
      .flatMap((row) => {
        const match = /^\S+ blob \S+\s+(\d+)\t(.*)$/.exec(row);
        return match ? [[match[2], Number(match[1])] as [string, number]] : [];
      });
  }
  return files.flatMap((path) => {
    const full = join(repo, path);
    return existsSync(full) ? [[path, statSync(full).size] as [string, number]] : [];
  });
}

export interface HygieneEvaluation {
  kind: "hygiene";
  runId: string;
  version: string;
  repo: string;
  ref: string;
  verdict: "pass" | "fail";
  files: number;
  issues: Issue[];
}

export function evaluateHygiene(repo: string, ref: string, options: HygieneOptions, tag?: string): HygieneEvaluation {
  const { issues, files } = checkHygiene(repo, ref, options);
  const evaluation: HygieneEvaluation = {
    kind: "hygiene",
    runId: newRunId(),
    version: evaluatorVersion(),
    repo,
    ref,
    verdict: issues.some((issue) => issue.severity === "error") ? "fail" : "pass",
    files,
    issues,
  };
  logRun({ ...evaluation, tag });
  return evaluation;
}
