import { toLines } from '../text-lines.ts';

/**
 * The config file's on-disk form.
 *
 * It has always been a shell-sourced file, and it stays hand-editable in the
 * same shape — but dirmirror now *parses* it rather than executing it, so a
 * stray backtick in a path is a value, not a command. The writer escapes on the
 * way out and the reader unescapes on the way in, so the round trip is exact.
 */

/** The settings dirmirror writes for itself. */
export interface ConfigSettings {
  readonly guestIp: string;
  readonly guestUser: string;
  readonly guestBase: string;
  readonly hostBase: string;
  readonly excludes: string;
  readonly includes: string;
  /** A switch, read through `isOn`: anything but the off words records the session. */
  readonly logging: string;
}

const GUEST_COMMENT =
  "# The guest VM's address and login user ('./dirmirror setup' re-discovers the address).";
const EXCLUDES_COMMENT =
  "# Extra rsync --exclude patterns (space-separated), added to dirmirror's built-in ignore list.";
const INCLUDES_COMMENT =
  '# Force-include patterns (space-separated) that override the ignore list, e.g. "App_Data".';
const LOGGING_COMMENT =
  '# "on" records the session to .dirmirror/dirmirror.log beside the tool; the menu\'s l) sets it.';
/**
 * The same line as dirmirror wrote it before the log moved out of this directory.
 * Still owned, so an existing config is rewritten with the new wording rather
 * than keeping the stale one as a stranger's line — which would outlive it.
 */
const FORMER_LOGGING_COMMENT =
  '# "on" records the session to dirmirror.log beside this file; the menu\'s l) sets it.';
export const KEPT_LINES_HEADER =
  '# Below: lines dirmirror did not write. Kept as-is when a setting changes.';

/**
 * Keys the writer re-emits itself. `HOST_IP`/`HOST_USER` are listed because
 * they are dropped on purpose, not merely unowned: loading hard-refuses a
 * config holding them, so carrying them across would leave the wizard
 * unstartable and undo what setup's migration exists to do.
 */
const OWNED_KEYS = [
  'GUEST_IP',
  'GUEST_USER',
  'GUEST_BASE',
  'HOST_BASE',
  'EXCLUDES',
  'INCLUDES',
  'LOGGING',
  'HOST_IP',
  'HOST_USER',
];

const OWNED_COMMENTS = [
  GUEST_COMMENT,
  EXCLUDES_COMMENT,
  INCLUDES_COMMENT,
  LOGGING_COMMENT,
  FORMER_LOGGING_COMMENT,
  KEPT_LINES_HEADER,
];

/**
 * One `KEY=value` assignment, with the optional `export ` a hand-edited file
 * might carry. {@link dirmirrorOwnsLine} matches the same prefix, and must keep
 * doing so: a form the reader honours but the writer does not claim gets
 * carried across, lands *after* the block written above it, and silently wins.
 */
const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/**
 * A quoted value plus whatever follows it, which a shell would have treated as
 * a trailing comment. Returns undefined when the value is not quoted.
 */
function unquoteDelimited(value: string): string | undefined {
  const quote = value[0];
  if (quote !== '"' && quote !== "'") return undefined;
  for (let i = 1; i < value.length; i += 1) {
    // Inside double quotes a backslash escapes the next character, so a `\"`
    // is part of the value rather than its end.
    if (quote === '"' && value[i] === '\\') {
      i += 1;
      continue;
    }
    if (value[i] === quote) {
      const body = value.slice(1, i);
      // Only the four characters that stay live inside double quotes can be
      // escaped there, so every other backslash is part of the value.
      return quote === '"' ? body.replace(/\\([\\"$`])/g, '$1') : body;
    }
  }
  return undefined; // unterminated: treat it as an ordinary bare value
}

function unquote(raw: string): string {
  const value = raw.trim();
  const quoted = unquoteDelimited(value);
  if (quoted !== undefined) return quoted;
  // Bare value: a shell ends it at whitespace followed by `#`, so a hash inside
  // the value itself (`/Volumes/a#b`) survives.
  return value.replace(/\s+#.*$/, '').trim();
}

/** Read every `KEY=value` assignment. A later one wins, the way sourcing would. */
export function parseConfig(contents: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of toLines(contents)) {
    const match = ASSIGNMENT.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      values[match[1]] = unquote(match[2]);
    }
  }
  return values;
}

/**
 * Escape a value for the double-quoted form. Only the four characters that stay
 * live inside double quotes need it, which leaves the ordinary case (spaces
 * included) as readable and hand-editable as it has always been.
 */
export function configValue(value: string): string {
  return value.replace(/[\\"$`]/g, '\\$&');
}

/** True when the writer re-emits this line itself, so carrying it across would duplicate it. */
export function dirmirrorOwnsLine(line: string): boolean {
  // Leading whitespace and an `export ` prefix are both ignored, so neither can
  // let an assignment survive as a duplicate: carried-over lines land *after*
  // the block written above them, so a surviving `  export EXCLUDES=...` would
  // override the value just written.
  const bare = line.endsWith('\r') ? line.slice(0, -1) : line;
  const trimmed = bare.replace(/^\s+/, '');
  if (OWNED_COMMENTS.includes(trimmed)) return true;
  const assignment = ASSIGNMENT.exec(bare);
  return assignment?.[1] !== undefined && OWNED_KEYS.includes(assignment[1]);
}

/**
 * Everything in the current file that dirmirror did not write — a note left in
 * the file, or a `DEFAULT_EXCLUDES`/`SSH_KEY` override. Trailing blank lines are
 * dropped so an all-blank remainder produces no kept block at all.
 */
export function extraLines(contents: string): string {
  return toLines(contents)
    .filter((line) => !dirmirrorOwnsLine(line))
    .join('\n')
    .replace(/\n+$/, '')
    .replace(/^\n+/, '');
}

/** Render the whole file: dirmirror's own block, then anything carried across. */
export function renderConfig(settings: ConfigSettings, carriedOver: string): string {
  const body = [
    GUEST_COMMENT,
    `GUEST_IP="${configValue(settings.guestIp)}"`,
    `GUEST_USER="${configValue(settings.guestUser)}"`,
    `GUEST_BASE="${configValue(settings.guestBase)}"`,
    `HOST_BASE="${configValue(settings.hostBase)}"`,
    EXCLUDES_COMMENT,
    `EXCLUDES="${configValue(settings.excludes)}"`,
    INCLUDES_COMMENT,
    `INCLUDES="${configValue(settings.includes)}"`,
    LOGGING_COMMENT,
    `LOGGING="${configValue(settings.logging)}"`,
  ].join('\n');
  if (carriedOver === '') return `${body}\n`;
  return `${body}\n${KEPT_LINES_HEADER}\n${carriedOver}\n`;
}
