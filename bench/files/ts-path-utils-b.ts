/**
 * Path handling shared by both sides of the sync. Pure string work: nothing
 * here touches the filesystem, so the guest's paths get the same treatment as
 * the host's without either needing to exist.
 */

/** Trim trailing slashes, but never turn `/` into the empty string. */
export function stripTrailingSlashes(path: string): string {
  let result = path;
  while (result.endsWith('/') && result !== '/') {
    result = result.slice(0, -1);
  }
  return result;
}

/** Expand a *leading* `~` against `home`. `~other` is left alone, as in a shell. */
export function expandTilde(home: string, path: string): string {
  if (path === '~') return stripTrailingSlashes(home);
  if (path.startsWith('~/')) return stripTrailingSlashes(`${home}/${path.slice(2)}`);
  return stripTrailingSlashes(path);
}

/**
 * Undo the shell quoting a terminal puts around a path.
 *
 * A path typed at a prompt is shell text: dragging a folder from Finder into
 * Terminal writes `Mobile\ Documents`, and wrapping a pasted path in quotes is
 * an equally common habit. We read those characters literally, so without this
 * the backslashes and quotes become part of the path and every directory test
 * rightly says the folder does not exist. A real backslash in a name is still
 * reachable as `\\`, the same way a shell spells it.
 */
export function unescapePath(path: string): string {
  // Single quotes: the content is already literal, backslashes included.
  if (path.length >= 2 && path.startsWith("'") && path.endsWith("'")) {
    return path.slice(1, -1);
  }
  // Inside double quotes a shell keeps most backslashes, but a path prompt is
  // better off forgiving than pedantic, so a dragged-and-then-quoted path works.
  let rest = path;
  if (rest.length >= 2 && rest.startsWith('"') && rest.endsWith('"')) {
    rest = rest.slice(1, -1);
  }
  let out = '';
  let escape = rest.indexOf('\\');
  while (escape !== -1) {
    // The escaped character is taken literally; a dangling trailing backslash
    // simply contributes nothing.
    out += rest.slice(0, escape) + rest.slice(escape + 1, escape + 2);
    rest = rest.slice(escape + 2);
    escape = rest.indexOf('\\');
  }
  return out + rest;
}

/**
 * A path as answered at a prompt. Only what the user typed is shell text, so
 * only that is unescaped — and only here, once. The default is an
 * already-stored path, and normalization runs on stored paths again elsewhere,
 * so both must stay idempotent.
 *
 * An answer that unescapes to nothing (`''` or `""`) falls back to the default
 * too: an empty path would be saved as an empty pairs column, which loading
 * drops, so the wizard would report a mapping it did not actually keep.
 */
export function typedPath(home: string, typed: string, fallback: string): string {
  const unescaped = typed === '' ? '' : unescapePath(typed);
  return expandTilde(home, unescaped === '' ? fallback : unescaped);
}

/** Abbreviate `home` as `~` for display. Host paths only — `~` means the guest's home there. */
export function prettyPath(home: string, path: string): string {
  if (path === home) return '~';
  if (path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
  return path;
}
