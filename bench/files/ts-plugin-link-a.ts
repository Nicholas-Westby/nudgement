/**
 * Links this repo into one Claude config directory as a skills-dir plugin.
 *
 * Claude loads any directory under <config dir>/skills holding a
 * .claude-plugin/plugin.json, so the symlink is the whole install: edits to a
 * SKILL.md are live and there is no copy to keep in sync.
 */

import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";

/** An error that may carry a Node errno code. */
type ErrnoLike = { code?: string };

/** The possible outcomes of linking the plugin. */
export type LinkAction = "created" | "already linked" | "repointed";

/** The result of linking the plugin into a config directory. */
export type LinkResult = {
  /** The Claude config directory. */
  configDir: string;
  /** The path of the symlink. */
  linkPath: string;
  /** What was done. */
  action: LinkAction;
  /** Where the link used to go. Only set when the action was "repointed". */
  previousTarget?: string;
  /** Skill names visible through the link, as Claude will see them. */
  skills: string[];
};

/**
 * lstat that reports "missing" instead of throwing.
 *
 * @param path - The path to stat.
 * @returns The stats for the path, or null if nothing exists there.
 */
function lstatOrNull(path: string) {
  try {
    return lstatSync(path);
  } catch (err) {
    if ((err as ErrnoLike).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Skill directories behind the link — the ones with a SKILL.md in them.
 *
 * @param linkPath - The path of the plugin link.
 * @returns The sorted names of the skills.
 */
function listSkills(linkPath: string): string[] {
  const skillsRoot = join(linkPath, "skills");
  let entries;
  try {
    entries = readdirSync(skillsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  // Keep only directories that contain a SKILL.md, then sort by name
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() && lstatOrNull(join(skillsRoot, entry.name, "SKILL.md")) !== null,
    )
    .map((entry) => entry.name)
    .sort();
}

/**
 * Points <configDir>/skills/<pluginName> at repoRoot, then verifies it by
 * reading back through the link. Throws rather than deleting anything when a
 * real file or directory is already sitting at the link path; in that case
 * nothing on disk has been touched, not even the skills directory.
 *
 * @param configDir - The Claude config directory to link into.
 * @param repoRoot - The root of this repository.
 * @param pluginName - The name of the plugin.
 * @returns The result of linking.
 */
export function linkPluginInto(
  configDir: string,
  repoRoot: string,
  pluginName: string,
): LinkResult {
  // Build the paths
  const skillsDir = join(configDir, "skills");
  const linkPath = join(skillsDir, pluginName);

  const existing = lstatOrNull(linkPath);

  // Refuse to replace a real file or directory
  if (existing !== null && !existing.isSymbolicLink()) {
    throw new Error(
      `${linkPath} already exists and is a real ${existing.isDirectory() ? "directory" : "file"}, not a symlink.\n` +
        `Move or remove it, then run this again. Nothing was changed.`,
    );
  }

  // Make sure the skills directory exists
  mkdirSync(skillsDir, { recursive: true });

  let action: LinkAction;
  let previousTarget: string | undefined;

  if (existing === null) {
    // No link yet, so create one
    symlinkSync(repoRoot, linkPath, "dir");
    action = "created";
  } else {
    // readlink may be relative to the directory holding the link, and the old
    // target may be gone entirely if the clone it pointed at was moved.
    const rawTarget = resolve(skillsDir, readlinkSync(linkPath));
    const currentTarget = lstatOrNull(rawTarget) === null ? rawTarget : realpathSync(rawTarget);

    if (currentTarget === repoRoot) {
      action = "already linked";
    } else {
      unlinkSync(linkPath);
      symlinkSync(repoRoot, linkPath, "dir");
      action = "repointed";
      previousTarget = currentTarget;
    }
  }

  // Read the plugin name back through the link
  let linkedName: unknown;
  try {
    linkedName = JSON.parse(
      readFileSync(join(linkPath, ".claude-plugin", "plugin.json"), "utf8"),
    ).name;
  } catch (err) {
    throw new Error(`link created but unreadable through ${linkPath}: ${(err as Error).message}`);
  }
  // Make sure the link resolves to the right plugin
  if (linkedName !== pluginName) {
    throw new Error(
      `link resolves to the wrong plugin: expected ${pluginName}, found ${JSON.stringify(linkedName)}`,
    );
  }

  // Return the result
  return { configDir, linkPath, action, previousTarget, skills: listSkills(linkPath) };
}
