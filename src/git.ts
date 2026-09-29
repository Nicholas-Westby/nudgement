import { parseDiff } from "./git-diff";

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
const NOISE_FILE =
  /(^|\/)(package-lock\.json|bun\.lockb?|pnpm-lock\.yaml|yarn\.lock)$|\.(min\.js|min\.css|map|snap)$|(^|\/)(dist|build|coverage)\//;

/** Added and removed lines in retained files; full deletions do not count toward review size. */
export function linesToReview(
  files: Pick<FileDiff, "path" | "added" | "removed">[],
  ignored: (path: string) => boolean = () => false,
): number {
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
  const diffText = git(repo, [
    "show",
    "--root",
    "--format=",
    "--patch",
    "--no-color",
    "--no-ext-diff",
    "-U6",
    sha,
    "--",
    ".",
    ...excludes,
  ]);
  const numstat = git(repo, ["show", "--root", "--format=", "--numstat", sha]);
  return { repo, ref: sha, message: message.trim(), files: parseDiff(diffText, numstat), diffText };
}

// Git's empty tree, for diffing against "before the first commit".
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** For an amend, compare the index with HEAD's parent so the message covers both changes. */
export function readStaged(repo: string, message: string, options: { amend?: boolean } = {}): CommitInput {
  const base = options.amend ? amendBase(repo) : [];
  const diffText = git(repo, [
    "diff",
    "--cached",
    ...base,
    "--no-color",
    "--no-ext-diff",
    "-U6",
    "--",
    ".",
    ...excludes,
  ]);
  const numstat = git(repo, ["diff", "--cached", ...base, "--numstat"]);
  return { repo, ref: "staged", message: message.trim(), files: parseDiff(diffText, numstat), diffText };
}

function amendBase(repo: string): string[] {
  const parent = Bun.spawnSync(["git", "-C", repo, "rev-parse", "--verify", "-q", "HEAD~1"], { stdout: "pipe" });
  return [parent.exitCode === 0 ? parent.stdout.toString().trim() : EMPTY_TREE];
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
export { parseDiff, withoutMovedLines } from "./git-diff";
export { grepArgs, grepPath, listFolder, mainCheckout, pathExists, pathsAt, readFileAt, repoRootOf } from "./git-files";
