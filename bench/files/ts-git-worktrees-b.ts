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

/** Line prefixes that appear in `git worktree list --porcelain` output. */
const PORCELAIN_PREFIXES = ["worktree ", "HEAD ", "branch ", "detached", "bare", "locked", "prunable"];

/**
 * Prints the message and stops, for the mistakes that have no recovery.
 *
 * @param message - The main error message to print.
 * @param rest - Any additional lines to print after the message.
 * @returns Never returns; the process exits.
 */
export function die(message: string, ...rest: string[]): never {
  // Print the main message
  console.error(message);
  // Print each additional line
  for (const line of rest) console.error(line);
  // Exit with a failure code
  process.exit(1);
}

/**
 * Runs git with its stderr going straight to the terminal, where its own error
 * messages are more use than they would be in a variable. Pass quiet for a
 * call whose failure is an answer rather than a problem, so git does not
 * announce a fatal error we went on to handle.
 *
 * @param args - The arguments to pass to git.
 * @param options - Options for the call.
 * @param options.quiet - Whether to capture stderr instead of showing it.
 * @returns The exit code and stdout of the git process.
 */
export function git(
  args: string[],
  { quiet = false }: { quiet?: boolean } = {},
): { code: number; stdout: string } {
  if (!Array.isArray(args)) {
    throw new TypeError("git() expects an array of arguments");
  }

  let result: ReturnType<typeof spawnSync>;
  try {
    // Spawn git synchronously and capture its output
    result = spawnSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", quiet ? "pipe" : "inherit"],
    });
  } catch (error) {
    console.error(`Unexpected error while running git ${args.join(" ")}:`, error);
    throw error;
  }

  if (result === null || result === undefined) die("cannot run git: no result returned");
  if (result.error) die(`cannot run git: ${result.error.message}`);

  // Return the exit code and stdout, defaulting both if missing
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  return { code: result.status ?? 1, stdout };
}

/**
 * Runs git and exits if it fails.
 *
 * @param args - The arguments to pass to git.
 * @returns The stdout of the git process.
 */
export function gitOrDie(args: string[]): string {
  // Run git
  const { code, stdout } = git(args);
  // Exit if git failed
  if (code !== 0) die(`git ${args.join(" ")} failed with exit code ${code}.`);
  // Return the output
  return stdout;
}

/**
 * Reads `git worktree list --porcelain`. Git always prints the main checkout
 * first, so entry 0 is the one holding the gitignored files (media, certs,
 * node_modules, webpack output) that every other worktree borrows.
 *
 * @param porcelain - The output of `git worktree list --porcelain`.
 * @returns The list of worktrees.
 */
export function parseWorktreeList(porcelain: string): Worktree[] {
  if (typeof porcelain !== "string") {
    throw new TypeError(`Expected porcelain output to be a string, got ${typeof porcelain}`);
  }

  const worktrees: Worktree[] = [];

  // Go through the output line by line
  for (const line of porcelain.split("\n")) {
    // Skip empty lines
    if (!line) continue;

    if (line.startsWith("worktree ")) {
      // Start a new worktree entry
      worktrees.push({ path: resolve(line.slice("worktree ".length).trim()), branch: null });
    } else if (line.startsWith("branch ") && worktrees.length > 0) {
      // Attach the branch to the most recent worktree
      const ref = line.slice("branch ".length).trim();
      const last = worktrees[worktrees.length - 1];
      if (last) {
        last.branch = ref.replace(/^refs\/heads\//, "");
      }
    }
  }

  // Return the parsed worktrees
  return worktrees;
}

/**
 * A path with its symlinks resolved, so that two spellings of one directory
 * compare equal: on macOS a path under /tmp and the same one under /private/tmp
 * are the same place, and the checks below have to see that. Falls back to a
 * plain resolve for a path that is not there any more.
 *
 * @param path - The path to canonicalize.
 * @returns The canonical path.
 */
export function canonical(path: string): string {
  try {
    return realpathSync(resolve(path));
  } catch {
    return resolve(path);
  }
}

/**
 * Every worktree of the repository that `fromPath` belongs to.
 *
 * @param fromPath - A path inside the repository.
 * @returns The worktrees, with canonical paths.
 */
export function listWorktrees(fromPath: string): Worktree[] {
  // Ask git for the list
  const porcelain = gitOrDie(["-C", fromPath, "worktree", "list", "--porcelain"]);
  // Parse it and canonicalize each path
  return parseWorktreeList(porcelain).map((worktree) => ({
    ...worktree,
    path: canonical(worktree.path),
  }));
}

/**
 * Returns true when the worktree has no branch checked out.
 *
 * @param worktree - The worktree to check.
 * @returns Whether the worktree is detached.
 */
function isDetached(worktree: Worktree): boolean {
  return worktree.branch === null;
}

/**
 * True when child is parent or sits underneath it. Whole path segments are
 * compared, so a sibling named `smrt_website-feature-x` is not treated as
 * living inside `smrt_website`.
 *
 * @param child - The path that may be inside.
 * @param parent - The path that may contain it.
 * @returns Whether child is inside parent.
 */
export function isInside(child: string, parent: string): boolean {
  if (typeof child !== "string" || typeof parent !== "string") {
    throw new TypeError("isInside expects two string paths");
  }
  const from = resolve(child);
  const of = resolve(parent);
  // Old version, which matched siblings with a shared prefix:
  // return from.startsWith(of);
  return from === of || from.startsWith(of.endsWith(sep) ? of : of + sep);
}

/**
 * Where a worktree goes when no path is given: beside the main checkout, named
 * after it and the branch. Outside the repository, so git never has to ignore
 * it, and next to it, so `ls ~/Dev` shows them together.
 *
 * @param main - The path of the main checkout.
 * @param branch - The branch the worktree is for.
 * @returns The default path for the worktree.
 */
export function defaultWorktreePath(main: string, branch: string): string {
  if (typeof main !== "string" || typeof branch !== "string") {
    throw new TypeError("defaultWorktreePath expects string arguments");
  }
  // Turn the branch name into a safe directory suffix
  const suffix = branch.split(/[/\\ ]/).filter(Boolean).join("-");
  // Put the worktree next to the main checkout
  return join(dirname(main), `${basename(main)}-${suffix}`);
}

export type RemovalCheck = { ok: true } | { ok: false; problem: string; hint?: string };

/**
 * Decides whether `target` is safe to hand to `git worktree remove`. The main
 * checkout is the whole point: everything gitignored lives there, and every
 * other worktree only borrows it.
 *
 * @param target - The worktree the user wants removed.
 * @param worktrees - Every worktree of the repository, main checkout first.
 * @param cwd - The current working directory.
 * @returns Whether removal is safe, and why not if it is not.
 */
export function checkRemovable(
  target: string,
  worktrees: Worktree[],
  cwd: string,
): RemovalCheck {
  if (!Array.isArray(worktrees)) {
    throw new TypeError("checkRemovable expects an array of worktrees");
  }

  // The main checkout is always listed first
  const main = worktrees.length > 0 ? worktrees[0]?.path : undefined;

  // Refuse to remove the main checkout
  if (target === main) {
    return {
      ok: false,
      problem: `Refusing: ${target} is the main checkout, not a worktree.`,
    };
  }

  // Refuse to remove something that is not a worktree
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

  // All checks passed
  return { ok: true };
}
