/**
 * Pre-commit check: formats staged Markdown with Prettier.
 *
 * It formats the *staged* copy of each file, not the working tree, so a
 * partially staged file never has its unstaged edits swept into the commit.
 * The working tree copy is rewritten too, but only when it already matches
 * the index and there is therefore nothing to clobber.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** Extend this to format more than Markdown. */
const FORMATTABLE = /\.(md|markdown)$/i;

/** Regular file modes; anything else (symlink, submodule) is left alone. */
const REGULAR_MODES = new Set(["100644", "100755"]);

function git(args: string[], input?: string): string {
  return execFileSync("git", args, {
    input,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

/** Split the NUL-delimited output produced by git's -z flags. */
function nulList(output: string): string[] {
  return output.split("\0").filter(Boolean);
}

/**
 * Returns a report of what it changed, or null when there was nothing to do.
 * Throws if anything staged could not be formatted; the index is left alone.
 */
export async function formatStagedMarkdown(): Promise<string | null> {
  // Hooks already run at the repo root, but saying so makes every path below
  // unambiguous whatever git decides to do with relative paths.
  const repoRoot = git(["rev-parse", "--show-toplevel"]).trim();
  process.chdir(repoRoot);

  const staged = nulList(
    git(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"]),
  ).filter((file) => FORMATTABLE.test(file));

  if (staged.length === 0) return null;

  let prettier: typeof import("prettier");
  try {
    prettier = await import("prettier");
  } catch {
    throw new Error("prettier is not installed — run `npm install`.");
  }

  // Files whose working tree copy differs from what is staged. Formatting those
  // on disk would mean staging, or losing, edits the commit was not meant to see.
  const partiallyStaged = new Set(
    nulList(git(["diff", "--name-only", "-z", "--", ...staged])),
  );

  // `mode sha stage\tpath` per entry — the mode to preserve and the blob to read.
  const indexEntries = new Map<string, { mode: string; sha: string }>();
  for (const entry of nulList(
    git(["ls-files", "--stage", "-z", "--", ...staged]),
  )) {
    const [meta, path] = entry.split("\t");
    const [mode, sha] = meta.split(" ");
    indexEntries.set(path, { mode, sha });
  }

  const updates: string[] = [];
  const formatted: string[] = [];
  const deferred: string[] = [];
  const failures: string[] = [];

  for (const file of staged) {
    const entry = indexEntries.get(file);
    if (!entry || !REGULAR_MODES.has(entry.mode)) continue;

    const fullPath = join(repoRoot, file);
    const info = await prettier.getFileInfo(fullPath, {
      ignorePath: ".prettierignore",
    });
    if (info.ignored || !info.inferredParser) continue;

    const source = git(["cat-file", "blob", entry.sha]);
    let output: string;
    try {
      const config = await prettier.resolveConfig(fullPath);
      output = await prettier.format(source, { ...config, filepath: fullPath });
    } catch (err) {
      failures.push(`${file}: ${(err as Error).message.split("\n")[0]}`);
      continue;
    }
    if (output === source) continue;

    const sha = git(["hash-object", "-w", "--stdin"], output).trim();
    updates.push(`${entry.mode} ${sha}\t${file}`);

    if (partiallyStaged.has(file)) {
      deferred.push(file);
    } else {
      writeFileSync(fullPath, output);
      formatted.push(file);
    }
  }

  // Bail before touching the index, so a broken file never leaves half the
  // commit reformatted and half not.
  if (failures.length > 0) {
    throw new Error(`Prettier could not format:\n  ${failures.join("\n  ")}`);
  }

  if (updates.length === 0) return null;

  git(["update-index", "-z", "--index-info"], `${updates.join("\0")}\0`);

  return [
    `formatted ${updates.length} file(s) with Prettier`,
    ...formatted.map((file) => `  ${file}`),
    ...deferred.map(
      (file) => `  ${file} (staged copy only — it has unstaged changes too)`,
    ),
  ].join("\n");
}
