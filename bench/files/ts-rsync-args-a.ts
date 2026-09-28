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

/** Split a stored space-separated pattern list. Patterns are never glob-expanded. */
function splitPatterns(list: string): string[] {
  return list.split(/\s+/).filter((pattern) => pattern !== '');
}

export function planRsync(input: RsyncPlanInput): RsyncPlan {
  const activeExcludes =
    input.excludes === '' ? input.defaultExcludes : `${input.defaultExcludes} ${input.excludes}`;
  const options = ['-a', '--delete'];
  if (!input.bypassFilters) {
    // Force-includes come first: rsync applies the first matching rule, so an
    // include placed after its exclude would never be reached.
    for (const pattern of splitPatterns(input.includes)) options.push('--include', pattern);
    for (const pattern of splitPatterns(activeExcludes)) options.push('--exclude', pattern);
  }
  options.push('-e', input.sshCommand);

  // The source keeps its trailing slash — to rsync that means "the contents of
  // this folder", not the folder itself. The destination gets none: rsync
  // ignores one there, but openrsync pastes the argument straight into its
  // diagnostics, where it reads as `.../thing1//public/images/x`.
  const remote = `${input.guestTarget}:${shellQuote(input.guestPath)}`;
  return {
    options,
    source: input.direction === 'pull' ? `${remote}/` : `${input.hostPath}/`,
    destination: input.direction === 'pull' ? input.hostPath : remote,
    activeExcludes,
  };
}

/** The quick dry run that produces the preview. */
export function previewArgs(plan: RsyncPlan): string[] {
  return ['-n', '-v', ...plan.options, plan.source, plan.destination];
}

/**
 * The second dry run, reading contents rather than timestamps. `--files-from`
 * sits *after* the filters so a scoped read still honours the excludes.
 */
export function checksumArgs(plan: RsyncPlan, filesFrom?: string): string[] {
  const scoped = filesFrom === undefined ? [] : [`--files-from=${filesFrom}`];
  return ['-n', '-v', '-c', ...plan.options, ...scoped, plan.source, plan.destination];
}

/** The transfer itself. */
export function transferArgs(plan: RsyncPlan): string[] {
  return [...plan.options, plan.source, plan.destination];
}
