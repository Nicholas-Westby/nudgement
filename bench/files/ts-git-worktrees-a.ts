/**
 * Git worktree plumbing shared by the scripts in this skill.
 *
 * The safety checks live here as pure functions so they can be tested without
 * a repository: the one that matters guards `git worktree remove`, which
 * deletes a directory holding a symlink to a 7.8 GB media library that is not
 * in git.
 */

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

export type Worktree = {
  /** Absolute path to the checkout. */
  path: string;
  /** Branch name, or null when the worktree is detached or bare. */
  branch: string | null;
};

/** Prints the message and stops, for the mistakes that have no recovery. */
export function die(message: string, ...rest: string[]): never {
  console.error(message);
  for (const line of rest) console.error(line);
  process.exit(1);
}

/**
 * Runs git with its stderr going straight to the terminal, where its own error
 * messages are more use than they would be in a variable. Pass quiet for a
 * call whose failure is an answer rather than a problem, so git does not
 * announce a fatal error we went on to handle.
 */
export function git(
  args: string[],
  { quiet = false }: { quiet?: boolean } = {},
): { code: number; stdout: string } {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", quiet ? "pipe" : "inherit"],
  });
  if (result.error) die(`cannot run git: ${result.error.message}`);
  return { code: result.status ?? 1, stdout: result.stdout ?? "" };
}

export function gitOrDie(args: string[]): string {
  const { code, stdout } = git(args);
  if (code !== 0) die(`git ${args.join(" ")} failed with exit code ${code}.`);
  return stdout;
}

/**
 * Reads `git worktree list --porcelain`. Git always prints the main checkout
 * first, so entry 0 is the one holding the gitignored files (media, certs,
 * node_modules, webpack output) that every other worktree borrows.
 */
export function parseWorktreeList(porcelain: string): Worktree[] {
  const worktrees: Worktree[] = [];

  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      worktrees.push({ path: resolve(line.slice("worktree ".length).trim()), branch: null });
    } else if (line.startsWith("branch ") && worktrees.length > 0) {
      const ref = line.slice("branch ".length).trim();
      worktrees[worktrees.length - 1].branch = ref.replace(/^refs\/heads\//, "");
    }
  }

  return worktrees;
}

/**
 * A path with its symlinks resolved, so that two spellings of one directory
 * compare equal: on macOS a path under /tmp and the same one under /private/tmp
 * are the same place, and the checks below have to see that. Falls back to a
 * plain resolve for a path that is not there any more.
 */
export function canonical(path: string): string {
  try {
    return realpathSync(resolve(path));
  } catch {
    return resolve(path);
  }
}

/** Every worktree of the repository that `fromPath` belongs to. */
export function listWorktrees(fromPath: string): Worktree[] {
  const porcelain = gitOrDie(["-C", fromPath, "worktree", "list", "--porcelain"]);
  return parseWorktreeList(porcelain).map((worktree) => ({
    ...worktree,
    path: canonical(worktree.path),
  }));
}

/**
 * True when child is parent or sits underneath it. Whole path segments are
 * compared, so a sibling named `smrt_website-feature-x` is not treated as
 * living inside `smrt_website`.
 */
export function isInside(child: string, parent: string): boolean {
  const from = resolve(child);
  const of = resolve(parent);
  return from === of || from.startsWith(of.endsWith(sep) ? of : of + sep);
}

/**
 * Where a worktree goes when no path is given: beside the main checkout, named
 * after it and the branch. Outside the repository, so git never has to ignore
 * it, and next to it, so `ls ~/Dev` shows them together.
 */
export function defaultWorktreePath(main: string, branch: string): string {
  const suffix = branch.split(/[/\\ ]/).filter(Boolean).join("-");
  return join(dirname(main), `${basename(main)}-${suffix}`);
}

export type RemovalCheck = { ok: true } | { ok: false; problem: string; hint?: string };

/**
 * Decides whether `target` is safe to hand to `git worktree remove`. The main
 * checkout is the whole point: everything gitignored lives there, and every
 * other worktree only borrows it.
 */
export function checkRemovable(
  target: string,
  worktrees: Worktree[],
  cwd: string,
): RemovalCheck {
  const main = worktrees[0]?.path;

  if (target === main) {
    return {
      ok: false,
      problem: `Refusing: ${target} is the main checkout, not a worktree.`,
    };
  }

  if (!worktrees.some((worktree) => worktree.path === target)) {
    return {
      ok: false,
      problem: `Refusing: ${target} is not a worktree of ${main}.`,
      hint: "Run 'git worktree list' to see the ones that are.",
    };
  }

  // git happily deletes the directory you are standing in, which leaves the
  // shell in a directory that no longer exists.
  if (isInside(cwd, target)) {
    return {
      ok: false,
      problem: `Refusing: you are inside ${target}.`,
      hint: `  cd ${main}, then run this again.`,
    };
  }

  return { ok: true };
}
