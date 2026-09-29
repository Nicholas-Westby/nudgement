import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { grepArgs, grepPath } from "./git";

// Git's tree/index mode for a submodule entry; ordinary files use 100644 or 100755.
const GITLINK_MODE = "160000 ";

// `git log`: %h is the short hash, %B the full message, and %xNN emits a byte.
// Control-byte separators preserve newlines in message bodies.
const COMMIT_FORMAT = "--format=%h%x00%B%x01";
const COMMIT_FIELD_SEPARATOR = "\u0000";
const COMMIT_RECORD_SEPARATOR = "\u0001";

// `git ls-tree -l`: mode, "blob", object ID, byte size, TAB, path.
// Only size and path are captured; trees and gitlinks have no blob size.
const BLOB_SIZE_ROW = /^\S+ blob \S+\s+(\d+)\t(.*)$/;

export function git(repo: string, args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" });
  return result.stdout.toString();
}

/** Every file that is, or would be, committed at `ref`. */
export function filesAt(repo: string, ref: string): string[] {
  const args =
    ref === "worktree"
      ? ["ls-files", "--cached", "--others", "--exclude-standard"]
      : ref === "staged"
        ? ["ls-files", "--cached"]
        : ["ls-tree", "-r", "--name-only", ref];
  const deleted =
    ref === "worktree" ? new Set(git(repo, ["ls-files", "--deleted"]).split("\n").filter(Boolean)) : new Set<string>();
  return [
    ...new Set(
      git(repo, args)
        .split("\n")
        .filter((path) => path && !deleted.has(path)),
    ),
  ];
}

/** Find nested repositories recorded as gitlinks without a matching .gitmodules entry. */
export function nestedRepos(repo: string, ref: string, files: string[]): string[] {
  const listing =
    ref === "worktree" || ref === "staged" ? git(repo, ["ls-files", "-s"]) : git(repo, ["ls-tree", "-r", ref]);
  const links = listing
    .split("\n")
    .filter((row) => row.startsWith(GITLINK_MODE))
    .map((row) => row.split("\t")[1]);
  // Untracked, git lists a nested repository as its folder, with a slash.
  const untracked =
    ref === "worktree" ? files.filter((path) => path.endsWith("/")).map((path) => path.slice(0, -1)) : [];
  const modules = git(repo, ["show", `${ref === "worktree" || ref === "staged" ? "" : ref}:.gitmodules`]);
  return [...new Set([...links, ...untracked])].filter((path) => !modules.includes(`path = ${path}\n`));
}

/** Lines matching any pattern, as { path, line, text }, from git grep at `ref`. */
export function grep(
  repo: string,
  ref: string,
  patterns: string[],
  flags: string[],
): { path: string; line: number; text: string }[] {
  if (!patterns.length) return [];
  const output = git(repo, [
    "grep",
    "-I",
    "-n",
    ...flags,
    ...patterns.flatMap((pattern) => ["-e", pattern]),
    ...grepArgs(ref),
    "--",
    ".",
  ]);
  return output
    .split("\n")
    .filter(Boolean)
    .flatMap((row) => {
      // git grep -n emits path:line:text; the final capture keeps colons in the text.
      const match = /^(.*?):(\d+):(.*)$/.exec(grepPath(row, ref));
      return match ? [{ path: match[1], line: Number(match[2]), text: match[3] }] : [];
    });
}

const globs = new Map<string, RegExp>();

function globToRegex(glob: string): RegExp {
  const cached = globs.get(glob);
  if (cached) return cached;
  // Protect ** with a NUL placeholder while translating *, which must not cross directories.
  // Escaping regex punctuation first keeps user patterns literal except for the glob wildcards.
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .split("\u0000")
    .join(".*");
  const regex = new RegExp(`^${escaped}$`, "i");
  globs.set(glob, regex);
  return regex;
}

/** A trailing slash matches a directory anywhere; a slashless glob matches the basename. */
export function matchesPath(path: string, pattern: string): boolean {
  if (pattern.endsWith("/")) {
    const dir = pattern.slice(0, -1);
    return path.startsWith(`${dir}/`) || path.includes(`/${dir}/`);
  }
  if (pattern.includes("/")) return globToRegex(pattern).test(path);
  return globToRegex(pattern).test(path.split("/").pop()!);
}

/** Keep hygiene warnings readable: show a few path:line locations and count the remaining matches. */
export const where = (hits: { path: string; line: number }[], limit = 5) =>
  hits
    .slice(0, limit)
    .map((hit) => `${hit.path}:${hit.line}`)
    .join(", ") + (hits.length > limit ? ` and ${hits.length - limit} more` : "");

/** Read all reachable commit messages; uncommitted views use HEAD, and an unborn branch has none. */
export function commitMessages(repo: string, ref: string): { sha: string; message: string }[] {
  const head = ref === "worktree" || ref === "staged" ? "HEAD" : ref;
  const hasHead = Bun.spawnSync(["git", "-C", repo, "rev-parse", "--verify", "-q", head]).exitCode === 0;
  if (!hasHead) return [];
  return git(repo, ["log", COMMIT_FORMAT, head])
    .split(COMMIT_RECORD_SEPARATOR)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, message] = entry.split(COMMIT_FIELD_SEPARATOR);
      return { sha, message: message.trim() };
    });
}

/** [path, bytes] from committed blobs, or disk for worktree/index checks (including untracked files). */
export function sizes(repo: string, ref: string, files: string[]): [string, number][] {
  if (ref !== "worktree" && ref !== "staged") {
    return git(repo, ["ls-tree", "-r", "-l", ref])
      .split("\n")
      .flatMap((row) => {
        const match = BLOB_SIZE_ROW.exec(row);
        return match ? [[match[2], Number(match[1])] as [string, number]] : [];
      });
  }
  return files.flatMap((path) => {
    const full = join(repo, path);
    return existsSync(full) ? [[path, statSync(full).size] as [string, number]] : [];
  });
}
