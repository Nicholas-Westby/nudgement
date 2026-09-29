import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The top of the git repository holding `path`, or undefined outside a repo. */
export function repoRootOf(path: string): string | undefined {
  const result = Bun.spawnSync(["git", "-C", path, "rev-parse", "--show-toplevel"], { stdout: "pipe", stderr: "pipe" });
  return result.exitCode === 0 ? result.stdout.toString().trim() : undefined;
}

/** The main checkout of the repo holding `dir`, which its linked worktrees share. Undefined outside a repo. */
export function mainCheckout(dir: string): string | undefined {
  const common = Bun.spawnSync(["git", "-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"])
    .stdout.toString()
    .trim();
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
  return (
    Bun.spawnSync(["git", "-C", repo, "cat-file", "-e", `${ref}:${path}`], { stdout: "pipe", stderr: "pipe" })
      .exitCode === 0
  );
}

/** Where `git grep` searches for `ref`: tracked and untracked files, the index, or a commit. */
export function grepArgs(ref: string): string[] {
  return ref === "worktree" ? ["--untracked"] : ref === "staged" ? ["--cached"] : [ref];
}

/** A `git grep` output line without the "commit:" that a search of a commit puts in front. */
export function grepPath(line: string, ref: string): string {
  return ref === "worktree" || ref === "staged" ? line : line.slice(line.indexOf(":") + 1);
}

/** List file and directory paths once for repeated existence checks.
 * Directory entries include a trailing-slash alias; submodules and "." are omitted. */
export function pathsAt(repo: string, ref: string): Set<string> {
  const staged = ref === "staged";
  const rows = Bun.spawnSync(["git", "-C", repo, ...(staged ? ["ls-files", "-z"] : ["ls-tree", "-r", "-z", ref])], {
    stdout: "pipe",
    stderr: "pipe",
  })
    .stdout.toString()
    .split("\0")
    .filter(Boolean);
  const paths = new Set<string>(staged && rows.length ? ["."] : []);
  for (const row of rows) {
    const tab = row.indexOf("\t");
    const path = staged ? row : row.slice(tab + 1);
    if (staged || !row.slice(0, tab).includes(" commit ")) paths.add(path);
    for (let slash = path.lastIndexOf("/"); slash > 0; slash = path.lastIndexOf("/", slash - 1))
      paths.add(path.slice(0, slash)).add(path.slice(0, slash + 1));
  }
  return paths;
}

/** Names directly inside a folder of the repo at `ref`, folders marked with a trailing slash. */
export function listFolder(repo: string, folder: string, ref: string): string[] {
  const dir = folder === "." ? "" : `${folder}/`;
  if (ref === "worktree") {
    const listed = Bun.spawnSync(
      ["git", "-C", repo, "ls-files", "--cached", "--others", "--exclude-standard", "--", dir || "."],
      { stdout: "pipe" },
    );
    return topLevel(listed.stdout.toString(), dir);
  }
  const args =
    ref === "staged" ? ["ls-files", "--", dir || "."] : ["ls-tree", "-r", "--name-only", ref, "--", dir || "."];
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
