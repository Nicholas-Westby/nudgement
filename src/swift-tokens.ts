/** Scan Swift strings and nesting without requiring a Swift toolchain.
 * This covers the syntax needed for copy extraction, not the full Swift grammar. */

export interface Token {
  kind: "id" | "str" | "num" | "punct";
  text: string;
  line: number;
  /** For a string: its text with escapes decoded and interpolation as {expr}. */
  value?: string;
}

export const OPEN: Record<string, string> = { "(": ")", "{": "}", "[": "]" };

const STRING_START = /^#*"/;

// Braces after these keywords belong to control flow, not a declaration or a SwiftUI view.
export const CONTROL = /^(if|guard|else|for|while|repeat|do|catch|defer)$/;

export function scanSwift(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const at = (offset = 0) => source[i + offset] ?? "";

  const readString = (): string => {
    // Raw strings repeat their opening hash count in the closing delimiter and escape/interpolation marker.
    let hashes = 0;
    while (at() === "#") {
      hashes++;
      i++;
    }
    const multi = source.startsWith('"""', i);
    i += multi ? 3 : 1;
    const close = (multi ? '"""' : '"') + "#".repeat(hashes);
    const escapeMarker = `\\${"#".repeat(hashes)}`;
    let value = "";
    while (i < source.length && !source.startsWith(close, i)) {
      if (!multi && at() === "\n") return value;
      if (!source.startsWith(escapeMarker, i)) {
        if (at() === "\n") line++;
        value += source[i++];
        continue;
      }
      i += escapeMarker.length;
      const c = source[i++];
      if (c === "(") {
        const start = i;
        skipInterpolation();
        value += `{${source.slice(start, i - 1).trim()}}`;
      } else if (c === "u" && at() === "{") {
        const end = source.indexOf("}", i);
        value += String.fromCodePoint(parseInt(source.slice(i + 1, end), 16));
        i = end + 1;
      } else if (c === "\n") line++;
      // Normalize escaped whitespace and NUL for copy review; retain the words a user would read.
      else value += /[ntr]/.test(c) ? " " : c === "0" ? "" : c;
    }
    i += close.length;
    return multi ? dedent(value) : value;
  };

  // Nested strings may contain parentheses that do not close the interpolation.
  const skipInterpolation = () => {
    for (let depth = 1; i < source.length && depth > 0; ) {
      if (STRING_START.test(source.slice(i, i + 8))) {
        readString();
        continue;
      }
      if (at() === "\n") line++;
      if (at() === "(") depth++;
      if (at() === ")") depth--;
      i++;
    }
  };

  while (i < source.length) {
    const c = at();
    if (c === "\n") {
      line++;
      i++;
    } else if (/\s/.test(c)) i++;
    else if (c === "/" && at(1) === "/") while (i < source.length && at() !== "\n") i++;
    else if (c === "/" && at(1) === "*") {
      for (let depth = 0; i < source.length; ) {
        if (at() === "/" && at(1) === "*") {
          depth++;
          i += 2;
        } else if (at() === "*" && at(1) === "/") {
          i += 2;
          if (--depth === 0) break;
        } else if (source[i++] === "\n") line++;
      }
    } else if (STRING_START.test(source.slice(i, i + 8))) {
      const start = line;
      tokens.push({ kind: "str", text: '"', line: start, value: readString() });
    } else {
      const word = /^[@#]?`?[\p{L}_$][\p{L}\p{N}_$]*`?/u.exec(source.slice(i))?.[0];
      const number = /^\d[\d_.xXa-fA-FeEpP]*/.exec(source.slice(i))?.[0];
      const pair = ["->", "??", "==", "!=", "&&", "||", "<=", ">="].find((op) => source.startsWith(op, i));
      const text = word ?? number ?? pair ?? c;
      tokens.push({ kind: word ? "id" : number ? "num" : "punct", text: text.replace(/`/g, ""), line });
      i += text.length;
    }
  }
  return joinConcatenated(tokens);
}

// A long message is often split over lines as "one " + "two".
function joinConcatenated(tokens: Token[]): Token[] {
  const joined: Token[] = [];
  for (const token of tokens) {
    const last = joined[joined.length - 2];
    if (token.kind === "str" && last?.kind === "str" && joined[joined.length - 1].text === "+") {
      joined.pop();
      last.value += token.value!;
    } else joined.push(token);
  }
  return joined;
}

// A multi-line string drops the indentation of its closing delimiter.
function dedent(value: string): string {
  const lines = value.replace(/^\n/, "").split("\n");
  const last = lines[lines.length - 1];
  const closing = /^\s*$/.test(last);
  const indent = closing ? last.length : 0;
  return lines
    .slice(0, closing ? -1 : undefined)
    .map((text) => text.slice(Math.min(indent, /^\s*/.exec(text)![0].length)))
    .join("\n");
}
