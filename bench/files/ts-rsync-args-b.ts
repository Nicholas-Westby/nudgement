import { shellQuote } from '../ssh/shell-quote.ts';

/** pull = guest → host, push = host → guest. Read from the host's point of view. */
export type Direction = 'pull' | 'push';

export interface RsyncPlanInput {
  readonly direction: Direction;
  readonly guestPath: string;
  readonly hostPath: string;
  readonly guestTarget: string;
  readonly sshCommand: string;
  readonly defaultExcludes: string;
  readonly excludes: string;
  readonly includes: string;
  /** Transfer everything, ignore list and all — the wizard's `1all`/`2all`. */
  readonly bypassFilters: boolean;
}

export interface RsyncPlan {
  /** Everything before the source and destination, shared by all three passes. */
  readonly options: readonly string[];
  readonly source: string;
  readonly destination: string;
  /** The full ignore list actually in force, for the `Ignoring:` line. */
  readonly activeExcludes: string;
}

/** Builds an rsync option list one flag at a time. */
export class RsyncOptionsBuilder {
  private readonly options: string[] = [];

  archive(): this {
    this.options.push('-a');
    return this;
  }

  deleteExtraneous(): this {
    this.options.push('--delete');
    return this;
  }

  include(pattern: string): this {
    this.options.push('--include', pattern);
    return this;
  }

  exclude(pattern: string): this {
    this.options.push('--exclude', pattern);
    return this;
  }

  remoteShell(command: string): this {
    this.options.push('-e', command);
    return this;
  }

  build(): string[] {
    return [...this.options];
  }
}

/** Split a stored space-separated pattern list. Patterns are never glob-expanded. */
function splitPatterns(list: string): string[] {
  const parts = list.split(/\s+/);
  const patterns: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part !== undefined && part !== '') {
      patterns.push(part);
    }
  }
  return patterns;
}

function activeExcludesFor(input: RsyncPlanInput): string {
  if (input.excludes === '') {
    return input.defaultExcludes;
  } else {
    return `${input.defaultExcludes} ${input.excludes}`;
  }
}

function remoteSpec(input: RsyncPlanInput): string {
  return `${input.guestTarget}:${shellQuote(input.guestPath)}`;
}

export function planRsync(input: RsyncPlanInput): RsyncPlan {
  const activeExcludes = activeExcludesFor(input);
  const builder = new RsyncOptionsBuilder().archive().deleteExtraneous();
  if (!input.bypassFilters) {
    // Force-includes come first: rsync applies the first matching rule, so an
    // include placed after its exclude would never be reached.
    const includes = splitPatterns(input.includes);
    for (const pattern of includes) {
      builder.include(pattern);
    }
    const excludes = splitPatterns(activeExcludes);
    for (const pattern of excludes) {
      builder.exclude(pattern);
    }
  }
  builder.remoteShell(input.sshCommand);
  const options = builder.build();

  // The source keeps its trailing slash — to rsync that means "the contents of
  // this folder", not the folder itself. The destination gets none: rsync
  // ignores one there, but openrsync pastes the argument straight into its
  // diagnostics, where it reads as `.../thing1//public/images/x`.
  const remote = remoteSpec(input);
  let source: string;
  let destination: string;
  if (input.direction === 'pull') {
    source = `${remote}/`;
    destination = input.hostPath;
  } else {
    source = `${input.hostPath}/`;
    destination = remote;
  }

  return {
    options,
    source,
    destination,
    activeExcludes,
  };
}

/** The quick dry run that produces the preview. */
export function previewArgs(plan: RsyncPlan): string[] {
  const args: string[] = [];
  args.push('-n');
  args.push('-v');
  for (const option of plan.options) {
    args.push(option);
  }
  args.push(plan.source);
  args.push(plan.destination);
  return args;
}

/**
 * The second dry run, reading contents rather than timestamps. `--files-from`
 * sits *after* the filters so a scoped read still honours the excludes.
 */
export function checksumArgs(plan: RsyncPlan, filesFrom?: string): string[] {
  const args: string[] = [];
  args.push('-n');
  args.push('-v');
  args.push('-c');
  for (const option of plan.options) {
    args.push(option);
  }
  if (filesFrom !== undefined) {
    args.push(`--files-from=${filesFrom}`);
  }
  args.push(plan.source);
  args.push(plan.destination);
  return args;
}

/** The transfer itself. */
export function transferArgs(plan: RsyncPlan): string[] {
  const args: string[] = [];
  for (const option of plan.options) {
    args.push(option);
  }
  args.push(plan.source);
  args.push(plan.destination);
  return args;
}
