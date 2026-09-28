/**
 * Finds the Claude Code config directories on this machine.
 *
 * Claude keeps its user-level settings, plugins and skills in the directory
 * named by CLAUDE_CONFIG_DIR, falling back to ~/.claude. Running more than one
 * profile therefore means more than one config directory: the agent-home
 * launcher uses ~/.claude, and agent-work sets CLAUDE_CONFIG_DIR to
 * ~/.agent-work (see skills/setting-up-profiles).
 *
 * Discovery is split into strategies, one per way a directory can be found,
 * which run in order against a shared registry.
 */

import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Why a directory is in the list; init reports it when something goes wrong. */
export type ConfigDirSource = "default" | "launcher" | "CLAUDE_CONFIG_DIR" | "discovered";

/** A config directory that was found. */
export interface ConfigDir {
  /** Absolute path to the directory. */
  path: string;
  /** How the directory was found. */
  source: ConfigDirSource;
}

/** A directory that looked like a candidate but was left alone, and why. */
export interface SkippedDir {
  /** Absolute path to the directory. */
  path: string;
  /** Human-readable reason it was skipped. */
  reason: string;
}

/** The result of a scan. */
export interface ConfigDirScan {
  /** Directories to act on. */
  dirs: ConfigDir[];
  /** Directories that were considered and rejected. */
  skipped: SkippedDir[];
}

/** Environment variables, as a plain record. */
export type Environment = Record<string, string | undefined>;

/** Options for {@link findClaudeConfigDirs}. */
export interface FindConfigDirsOptions {
  /** Home directory to search. Defaults to the current user's. */
  home?: string;
  /** Environment to read CLAUDE_CONFIG_DIR from. Defaults to process.env. */
  env?: Environment;
  /** Profiles the launchers in ~/.zshrc start Claude in, as names under home. */
  launcherDirs?: string[];
  /** Files or folders whose presence marks a directory as used by Claude. */
  markers?: string[];
  /** Pattern a directory name must match to count as a profile. */
  profilePattern?: RegExp;
  /** File system access. Defaults to the real file system. */
  fs?: FileSystemAdapter;
  /** Extra strategies, run after the built-in ones. */
  strategies?: DiscoveryStrategy[];
  /** Log every decision to stderr. */
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Profiles are named ~/.claude-<something>; ~/.claude itself is the default. */
const DEFAULT_PROFILE_PATTERN = /^\.claude-.+$/;

/**
 * Things Claude itself puts in a config directory. A ~/.claude-* directory
 * needs at least one of them before it counts, so an unrelated directory that
 * happens to start with ".claude-" never gets a skills folder planted in it.
 */
const DEFAULT_CONFIG_MARKERS = [
  ".claude.json",
  "settings.json",
  "history.jsonl",
  "projects",
  "plugins",
  "sessions",
  "skills",
];

// ---------------------------------------------------------------------------
// File system
// ---------------------------------------------------------------------------

/** The file system operations discovery needs. */
export interface FileSystemAdapter {
  exists(path: string): boolean;
  isDirectory(path: string): boolean;
  listDirectory(path: string): string[];
}

/** {@link FileSystemAdapter} backed by node:fs. */
export class NodeFileSystemAdapter implements FileSystemAdapter {
  exists(path: string): boolean {
    try {
      statSync(path);
      return true;
    } catch {
      return false;
    }
  }

  /** Follows symlinks, so a profile kept elsewhere and linked in still counts. */
  isDirectory(path: string): boolean {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  }

  listDirectory(path: string): string[] {
    return readdirSync(path);
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Collects found and skipped directories, ignoring duplicates. */
export class ConfigDirRegistry {
  private readonly dirs: ConfigDir[] = [];
  private readonly skipped: SkippedDir[] = [];
  private readonly seen = new Set<string>();
  private readonly log: (message: string) => void;

  constructor(log: (message: string) => void) {
    this.log = log;
  }

  /**
   * Adds a directory unless it is already registered.
   * @returns True if the directory was added.
   */
  add(path: string, source: ConfigDirSource): boolean {
    const full = resolve(path);
    if (this.seen.has(full)) {
      this.log(`already registered: ${full}`);
      return false;
    }
    this.seen.add(full);
    this.dirs.push({ path: full, source });
    this.log(`added ${full} (${source})`);
    return true;
  }

  /** Records a directory that was considered and rejected. */
  skip(path: string, reason: string): void {
    this.skipped.push({ path, reason });
    this.log(`skipped ${path}: ${reason}`);
  }

  /** Returns true if the path has already been registered. */
  has(path: string): boolean {
    return this.seen.has(path);
  }

  /** Returns the scan result. */
  toScan(): ConfigDirScan {
    return { dirs: [...this.dirs], skipped: [...this.skipped] };
  }
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

/** Everything a strategy needs to do its work. */
export interface DiscoveryContext {
  home: string;
  env: Environment;
  launcherDirs: string[];
  markers: string[];
  profilePattern: RegExp;
  fs: FileSystemAdapter;
  registry: ConfigDirRegistry;
  log: (message: string) => void;
}

/** One way of finding config directories. */
export interface DiscoveryStrategy {
  readonly name: string;
  discover(context: DiscoveryContext): void;
}

/**
 * Always a target, existing or not: it is what Claude uses with no
 * CLAUDE_CONFIG_DIR set, so on a fresh machine this is the one that matters.
 */
export class DefaultDirStrategy implements DiscoveryStrategy {
  readonly name = "default";

  discover(context: DiscoveryContext): void {
    context.registry.add(join(context.home, ".claude"), "default");
  }
}

/**
 * Also targets whether or not Claude has run there yet: a launcher is about
 * to start Claude in them, and linking first means a new profile has the
 * skills from its very first session.
 */
export class LauncherDirStrategy implements DiscoveryStrategy {
  readonly name = "launcher";

  discover(context: DiscoveryContext): void {
    for (const dir of context.launcherDirs) {
      context.registry.add(join(context.home, dir), "launcher");
    }
  }
}

/**
 * An explicit CLAUDE_CONFIG_DIR covers a profile living outside $HOME or not
 * following the ~/.claude-* naming. It has to already exist — creating one
 * from a typo, or from a tilde the shell never expanded, would leave a stray
 * directory behind that Claude would never read.
 */
export class EnvDirStrategy implements DiscoveryStrategy {
  readonly name = "CLAUDE_CONFIG_DIR";

  discover(context: DiscoveryContext): void {
    const configured = context.env.CLAUDE_CONFIG_DIR?.trim();
    if (!configured) {
      context.log("CLAUDE_CONFIG_DIR is not set");
      return;
    }
    const path = resolve(configured);
    if (context.fs.isDirectory(path)) {
      context.registry.add(path, "CLAUDE_CONFIG_DIR");
    } else if (!context.registry.has(path)) {
      context.registry.skip(path, "CLAUDE_CONFIG_DIR is set but there is no such directory");
    }
  }
}

/** Finds ~/.claude-* directories that Claude has used. */
export class ProfileScanStrategy implements DiscoveryStrategy {
  readonly name = "discovered";

  discover(context: DiscoveryContext): void {
    let entries: string[];
    try {
      entries = context.fs.listDirectory(context.home).sort();
    } catch (error) {
      // No readable home directory. The default target still stands.
      context.log(`cannot read ${context.home}: ${(error as Error).message}`);
      return;
    }

    for (const entry of entries) {
      if (!context.profilePattern.test(entry)) continue;

      const path = join(context.home, entry);
      if (context.registry.has(path)) continue;
      if (!context.fs.isDirectory(path)) continue;

      if (this.looksUsedByClaude(path, context)) {
        context.registry.add(path, "discovered");
      } else {
        context.registry.skip(path, "nothing of Claude's in it, so it is probably not a profile");
      }
    }
  }

  private looksUsedByClaude(path: string, context: DiscoveryContext): boolean {
    return context.markers.some((marker) => context.fs.exists(join(path, marker)));
  }
}

/** The built-in strategies, in the order they run. */
export function defaultStrategies(): DiscoveryStrategy[] {
  return [
    new DefaultDirStrategy(),
    new LauncherDirStrategy(),
    new EnvDirStrategy(),
    new ProfileScanStrategy(),
  ];
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Finds every Claude config directory on the machine.
 * @param options - Discovery options.
 * @returns The directories found and the ones skipped.
 */
export function findClaudeConfigDirs(options: FindConfigDirsOptions = {}): ConfigDirScan {
  const log = options.verbose
    ? (message: string) => console.error(`[config-dirs] ${message}`)
    : () => {};

  const home = resolve(options.home ?? homedir());
  const registry = new ConfigDirRegistry(log);
  const context: DiscoveryContext = {
    home,
    env: options.env ?? process.env,
    launcherDirs: options.launcherDirs ?? [],
    markers: options.markers ?? DEFAULT_CONFIG_MARKERS,
    profilePattern: options.profilePattern ?? DEFAULT_PROFILE_PATTERN,
    fs: options.fs ?? new NodeFileSystemAdapter(),
    registry,
    log,
  };

  log(`scanning ${home}`);
  for (const strategy of [...defaultStrategies(), ...(options.strategies ?? [])]) {
    log(`running strategy: ${strategy.name}`);
    strategy.discover(context);
  }

  const scan = registry.toScan();
  log(`found ${scan.dirs.length} director${scan.dirs.length === 1 ? "y" : "ies"}, skipped ${scan.skipped.length}`);
  return scan;
}
