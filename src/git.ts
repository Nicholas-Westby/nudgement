/**
 * Reads what gets judged out of a git repository: the commit message, the
 * diff, and the per-file line counts. Works for an existing commit or for the
 * staged changes plus a proposed message, so a message can be checked before
 * it is committed.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface DiffLine {
  kind: "+" | "-" | " ";
  text: string;
  /** Line number in the new file, for added and context lines. */
  newLine?: number;
}

export interface FileDiff {
  path: string;
  added: number;
  removed: number;
  binary: boolean;
  lines: DiffLine[];
}

// Lockfiles, minified and generated output say nothing a reviewer reads.
const NOISE_FILE = /(^|\/)(package-lock\.json|bun\.lockb?|pnpm-lock\.yaml|yarn\.lock)$|\.(min\.js|min\.css|map|snap)$|(^|\/)(dist|build|coverage)\//;

/** How many changed lines a reviewer has to read. A file with nothing added, such as one deleted whole, costs nothing to follow. */
export function linesToReview(files: Pick<FileDiff, "path" | "added" | "removed">[], ignored: (path: string) => boolean = () => false): number {
  return files
    .filter((file) => file.added > 0 && !NOISE_FILE.test(file.path) && !ignored(file.path))
    .reduce((sum, file) => sum + file.added + file.removed, 0);
}

export interface CommitInput {
  repo: string;
  /** The commit hash, or "staged" when judging a proposed message. */
  ref: string;
  message: string;
  files: FileDiff[];
  /** The unified diff as text, with noise files left out. */
  diffText: string;
}

// Files whose diffs say nothing about intent and would crowd out the real change.
const NOISE = [
  "*.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.snap",
];

export function git(repo: string, args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString();
}

const excludes = NOISE.map((pattern) => `:(exclude,glob)**/${pattern}`);

export function readCommit(repo: string, hash: string, messageOverride?: string): CommitInput {
  const sha = git(repo, ["rev-parse", "--verify", `${hash}^{commit}`]).trim();
  const message = messageOverride ?? git(repo, ["show", "-s", "--format=%B", sha]);
  // --root makes the first commit of a repo diff against nothing instead of showing no diff.
  const diffText = git(repo, ["show", "--root", "--format=", "--patch", "--no-color", "--no-ext-diff", "-U6", sha, "--", ".", ...excludes]);
  const numstat = git(repo, ["show", "--root", "--format=", "--numstat", sha]);
  return { repo, ref: sha, message: message.trim(), files: parseDiff(diffText, numstat), diffText };
}

// Git's empty tree, for diffing against "before the first commit".
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * The staged changes and a proposed message. With amend, the staged changes
 * are read together with HEAD, since `git commit --amend` folds them into it
 * and the message has to describe both.
 */
export function readStaged(repo: string, message: string, options: { amend?: boolean } = {}): CommitInput {
  const base = options.amend ? amendBase(repo) : [];
  const diffText = git(repo, ["diff", "--cached", ...base, "--no-color", "--no-ext-diff", "-U6", "--", ".", ...excludes]);
  const numstat = git(repo, ["diff", "--cached", ...base, "--numstat"]);
  return { repo, ref: "staged", message: message.trim(), files: parseDiff(diffText, numstat), diffText };
}

function amendBase(repo: string): string[] {
  const parent = Bun.spawnSync(["git", "-C", repo, "rev-parse", "--verify", "-q", "HEAD~1"], { stdout: "pipe" });
  return [parent.exitCode === 0 ? parent.stdout.toString().trim() : EMPTY_TREE];
}

export function parseDiff(diffText: string, numstat: string): FileDiff[] {
  const files = new Map<string, FileDiff>();

  for (const row of numstat.split("\n")) {
    const [added, removed, ...rest] = row.split("\t");
    if (!rest.length) continue;
    const path = normalizeRename(rest.join("\t"));
    files.set(path, {
      path,
      added: added === "-" ? 0 : Number(added),
      removed: removed === "-" ? 0 : Number(removed),
      binary: added === "-",
      lines: [],
    });
  }

  let current: FileDiff | undefined;
  let newLine = 0;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = undefined;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).replace(/^b\//, "");
      if (path === "/dev/null") continue;
      current = files.get(path) ?? { path, added: 0, removed: 0, binary: false, lines: [] };
      files.set(path, current);
      continue;
    }
    if (line.startsWith("--- ")) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (!current) continue;
    const kind = line[0];
    if (kind === "+") current.lines.push({ kind: "+", text: line.slice(1), newLine: newLine++ });
    else if (kind === " ") current.lines.push({ kind: " ", text: line.slice(1), newLine: newLine++ });
    else if (kind === "-") current.lines.push({ kind: "-", text: line.slice(1) });
  }

  return [...files.values()];
}

// numstat prints renames as "old => new" or "dir/{old => new}/file".
function normalizeRename(path: string): string {
  const braces = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(path);
  if (braces) return (braces[1] + braces[3] + braces[4]).replace(/\/\//g, "/");
  const plain = /^(.*) => (.*)$/.exec(path);
  return plain ? plain[2] : path;
}

/** The top of the git repository holding `path`, or undefined outside a repo. */
export function repoRootOf(path: string): string | undefined {
  const result = Bun.spawnSync(["git", "-C", path, "rev-parse", "--show-toplevel"], { stdout: "pipe", stderr: "pipe" });
  return result.exitCode === 0 ? result.stdout.toString().trim() : undefined;
}

/** The main checkout of the repo holding `dir`, which its linked worktrees share. Undefined outside a repo. */
export function mainCheckout(dir: string): string | undefined {
  const common = Bun.spawnSync(["git", "-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"]).stdout.toString().trim();
  return common ? dirname(common) : undefined;
}

/** A file's text in the working tree, the index ("staged"), or a commit. Undefined when it does not exist there. */
export function readFileAt(repo: string, path: string, ref: string): string | undefined {
  if (ref === "worktree") {
    const full = join(repo, path);
    return existsSync(full) ? readFileSync(full, "utf8") : undefined;
  }
  const spec = ref === "staged" ? `:${path}` : `${ref}:${path}`;
  const result = Bun.spawnSync(["git", "-C", repo, "show", spec], { stdout: "pipe", stderr: "pipe" });
  return result.exitCode === 0 ? result.stdout.toString() : undefined;
}

/** Whether a file or folder exists in the working tree, the index ("staged"), or a commit. */
export function pathExists(repo: string, path: string, ref: string): boolean {
  if (ref === "worktree") return existsSync(join(repo, path));
  if (ref === "staged") {
    const listed = Bun.spawnSync(["git", "-C", repo, "ls-files", "--", path], { stdout: "pipe", stderr: "pipe" });
    return listed.stdout.toString().trim().length > 0;
  }
  return Bun.spawnSync(["git", "-C", repo, "cat-file", "-e", `${ref}:${path}`], { stdout: "pipe", stderr: "pipe" }).exitCode === 0;
}

/** Where `git grep` searches for `ref`: tracked and untracked files, the index, or a commit. */
export function grepArgs(ref: string): string[] {
  return ref === "worktree" ? ["--untracked"] : ref === "staged" ? ["--cached"] : [ref];
}

/** A `git grep` output line without the "commit:" that a search of a commit puts in front. */
export function grepPath(line: string, ref: string): string {
  return ref === "worktree" || ref === "staged" ? line : line.slice(line.indexOf(":") + 1);
}

/**
 * Every path pathExists would find in the index ("staged") or a commit, read
 * in one call for checking many paths. Folders are there with and without a
 * trailing slash. As with cat-file, a commit's submodules and "." are not.
 */
export function pathsAt(repo: string, ref: string): Set<string> {
  const staged = ref === "staged";
  const rows = Bun.spawnSync(["git", "-C", repo, ...(staged ? ["ls-files", "-z"] : ["ls-tree", "-r", "-z", ref])], { stdout: "pipe", stderr: "pipe" })
    .stdout.toString()
    .split("\0")
    .filter(Boolean);
  const paths = new Set<string>(staged && rows.length ? ["."] : []);
  for (const row of rows) {
    const tab = row.indexOf("\t");
    const path = staged ? row : row.slice(tab + 1);
    if (staged || !row.slice(0, tab).includes(" commit ")) paths.add(path);
    for (let slash = path.lastIndexOf("/"); slash > 0; slash = path.lastIndexOf("/", slash - 1)) paths.add(path.slice(0, slash)).add(path.slice(0, slash + 1));
  }
  return paths;
}

/** Names directly inside a folder of the repo at `ref`, folders marked with a trailing slash. */
export function listFolder(repo: string, folder: string, ref: string): string[] {
  const dir = folder === "." ? "" : `${folder}/`;
  if (ref === "worktree") {
    const listed = Bun.spawnSync(["git", "-C", repo, "ls-files", "--cached", "--others", "--exclude-standard", "--", dir || "."], { stdout: "pipe" });
    return topLevel(listed.stdout.toString(), dir);
  }
  const args = ref === "staged" ? ["ls-files", "--", dir || "."] : ["ls-tree", "-r", "--name-only", ref, "--", dir || "."];
  return topLevel(Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe" }).stdout.toString(), dir);
}

function topLevel(listing: string, dir: string): string[] {
  const names = new Set<string>();
  for (const path of listing.split("\n").filter(Boolean)) {
    const rest = path.slice(dir.length);
    const slash = rest.indexOf("/");
    names.add(slash >= 0 ? rest.slice(0, slash + 1) : rest);
  }
  return [...names].sort();
}

/**
 * The diff with lines the commit only moved, from one place or file to
 * another, turned into context: moving code is not writing it, so the checks
 * that judge what a commit wrote leave it alone.
 */
export function withoutMovedLines(files: FileDiff[]): FileDiff[] {
  const removed = new Map<string, number>();
  for (const file of files) for (const line of file.lines) if (line.kind === "-") removed.set(line.text.trim(), (removed.get(line.text.trim()) ?? 0) + 1);
  return files.map((file) => {
    const lines = file.lines.map((line) => {
      if (line.kind !== "+") return line;
      const key = line.text.trim();
      const left = removed.get(key) ?? 0;
      if (left > 0) removed.set(key, left - 1);
      return left > 0 ? { ...line, kind: " " as const } : line;
    });
    return { ...file, lines, added: lines.filter((line) => line.kind === "+").length };
  });
}

/** Whether earlier commits to these files already use `scope`, at least twice: then it is this repo's name for them. */
export function usesScope(repo: string, ref: string, scope: string, paths: string[]): boolean {
  if (!paths.length) return false;
  const before = ref === "staged" || ref === "worktree" ? "HEAD" : `${ref}^`;
  let subjects: string[];
  try {
    subjects = git(repo, ["log", "-n", "200", "--format=%s", before, "--", ...paths.slice(0, 20)]).split("\n");
  } catch {
    // No earlier commits, as for a first commit.
    return false;
  }
  const pattern = new RegExp(`^\\w+!?\\(${scope.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)!?:`);
  return subjects.filter((subject) => pattern.test(subject)).length >= 2;
}
