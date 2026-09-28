/**
 * Finds the Claude Code config directories on this machine.
 *
 * Claude keeps its user-level settings, plugins and skills in the directory
 * named by CLAUDE_CONFIG_DIR, falling back to ~/.claude. Running more than one
 * profile therefore means more than one config directory: the agent-home
 * launcher uses ~/.claude, and agent-work sets CLAUDE_CONFIG_DIR to
 * ~/.agent-work (see skills/setting-up-profiles).
 *
 * Which profiles exist differs per machine — a work profile set up on one may
 * be absent on another — so nothing here is hardcoded and a missing profile is
 * never an error. ~/.claude is always a target, as is any profile the caller
 * says a launcher starts, a ~/.claude-* sibling is a target once it looks like
 * Claude has used it, and CLAUDE_CONFIG_DIR is a target whenever it is set and
 * real.
 */

import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Why a directory is in the list; init reports it when something goes wrong. */
export type ConfigDirSource = "default" | "launcher" | "CLAUDE_CONFIG_DIR" | "discovered";

export type ConfigDir = { path: string; source: ConfigDirSource };

/** A directory that looked like a candidate but was left alone, and why. */
export type SkippedDir = { path: string; reason: string };

export type ConfigDirScan = { dirs: ConfigDir[]; skipped: SkippedDir[] };

/** Profiles are named ~/.claude-<something>; ~/.claude itself is the default. */
const PROFILE_PATTERN = /^\.claude-.+$/;

/**
 * Things Claude itself puts in a config directory. A ~/.claude-* directory
 * needs at least one of them before it counts, so an unrelated directory that
 * happens to start with ".claude-" never gets a skills folder planted in it.
 */
const CONFIG_MARKERS = [
  ".claude.json",
  "settings.json",
  "history.jsonl",
  "projects",
  "plugins",
  "sessions",
  "skills",
];

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Follows symlinks, so a profile kept elsewhere and linked in still counts. */
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function looksUsedByClaude(path: string): boolean {
  return CONFIG_MARKERS.some((marker) => exists(join(path, marker)));
}

export function findClaudeConfigDirs(
  options: {
    home?: string;
    env?: Record<string, string | undefined>;
    /** Profiles the launchers in ~/.zshrc start Claude in, as names under home. */
    launcherDirs?: string[];
  } = {},
): ConfigDirScan {
  const home = resolve(options.home ?? homedir());
  const env = options.env ?? process.env;

  const dirs: ConfigDir[] = [];
  const skipped: SkippedDir[] = [];
  const seen = new Set<string>();

  function add(path: string, source: ConfigDirSource): void {
    const full = resolve(path);
    if (seen.has(full)) return;
    seen.add(full);
    dirs.push({ path: full, source });
  }

  // Always a target, existing or not: it is what Claude uses with no
  // CLAUDE_CONFIG_DIR set, so on a fresh machine this is the one that matters.
  add(join(home, ".claude"), "default");

  // Also targets whether or not Claude has run there yet: a launcher is about
  // to start Claude in them, and linking first means a new profile has the
  // skills from its very first session.
  for (const dir of options.launcherDirs ?? []) add(join(home, dir), "launcher");

  // An explicit CLAUDE_CONFIG_DIR covers a profile living outside $HOME or not
  // following the ~/.claude-* naming. It has to already exist — creating one
  // from a typo, or from a tilde the shell never expanded, would leave a stray
  // directory behind that Claude would never read.
  const configured = env.CLAUDE_CONFIG_DIR?.trim();
  if (configured) {
    const path = resolve(configured);
    if (isDirectory(path)) {
      add(path, "CLAUDE_CONFIG_DIR");
    } else if (!seen.has(path)) {
      skipped.push({ path, reason: "CLAUDE_CONFIG_DIR is set but there is no such directory" });
    }
  }

  let entries: string[];
  try {
    entries = readdirSync(home).sort();
  } catch {
    // No readable home directory. The default target above still stands.
    return { dirs, skipped };
  }

  for (const entry of entries) {
    if (!PROFILE_PATTERN.test(entry)) continue;

    const path = join(home, entry);
    if (seen.has(path)) continue;
    if (!isDirectory(path)) continue;

    if (looksUsedByClaude(path)) {
      add(path, "discovered");
    } else {
      skipped.push({ path, reason: "nothing of Claude's in it, so it is probably not a profile" });
    }
  }

  return { dirs, skipped };
}
