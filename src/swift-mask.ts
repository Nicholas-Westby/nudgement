/** Blank strings and comments without moving offsets used by the structural scans. */
export function blankSwift(source: string): string {
  const out = source.split("");
  const fill = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  // Returns the index just past the string that opens at `start` (on its first # or quote).
  const skipString = (start: number): number => {
    let i = start;
    let hashes = 0;
    while (source[i] === "#") {
      hashes++;
      i++;
    }
    const multiline = source.startsWith('"""', i);
    const quote = multiline ? '"""' : '"';
    const close = quote + "#".repeat(hashes);
    const escapeMarker = `\\${"#".repeat(hashes)}`;
    const bodyStart = i + quote.length;
    let j = bodyStart;
    while (j < source.length && !source.startsWith(close, j)) {
      if (!multiline && source[j] === "\n") break;
      if (source.startsWith(escapeMarker, j)) {
        j += escapeMarker.length;
        // An interpolation such as \(f("x")) may hold strings of its own.
        if (source[j] === "(") j = skipParens(j);
        else j++;
      } else j++;
    }
    fill(bodyStart, j);
    return source.startsWith(close, j) ? j + close.length : j;
  };
  const skipParens = (open: number): number => {
    let depth = 0;
    let j = open;
    while (j < source.length) {
      if (source[j] === '"' || (source[j] === "#" && /^#+"/.test(source.slice(j, j + 8)))) {
        j = skipString(j);
        continue;
      }
      if (source[j] === "(") depth++;
      else if (source[j] === ")" && --depth === 0) return j + 1;
      j++;
    }
    return j;
  };
  let i = 0;
  while (i < source.length) {
    if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i);
      fill(i, end < 0 ? source.length : end);
      i = end < 0 ? source.length : end;
    } else if (source.startsWith("/*", i)) {
      // Swift block comments nest.
      let depth = 0;
      let j = i;
      while (j < source.length) {
        if (source.startsWith("/*", j)) {
          depth++;
          j += 2;
        } else if (source.startsWith("*/", j)) {
          j += 2;
          if (--depth === 0) break;
        } else j++;
      }
      fill(i, j);
      i = j;
    } else if (source[i] === '"' || (source[i] === "#" && /^#+"/.test(source.slice(i, i + 8)))) {
      i = skipString(i);
    } else i++;
  }
  return out.join("");
}

/** Find a closing bracket in masked source. Also used by JavaScript test parsing. */
export function matching(blanked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < blanked.length; i++) {
    const char = blanked[i];
    if (char === "(" || char === "[" || char === "{") depth++;
    else if (char === ")" || char === "]" || char === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return blanked.length - 1;
}

export const lineAt = (source: string, offset: number) => source.slice(0, offset).split("\n").length;
