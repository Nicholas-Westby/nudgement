/**
 * Just enough of Swift's structure to tell where a string literal sits: a
 * scanner that skips comments and decodes strings (escapes, raw #"…"#,
 * multi-line """ and interpolation "\(x)" shown as {x}), and queries over the
 * bracket nesting, such as which call a string is an argument of or what owns
 * a closure. There is no Swift parser for TypeScript, and a view needs no more.
 */

export interface Token {
  kind: "id" | "str" | "num" | "punct";
  text: string;
  line: number;
  /** For a string: its text with escapes decoded and interpolation as {expr}. */
  value?: string;
}

const OPEN: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
const STRING_START = /^#*"/;
const CONTROL = /^(if|guard|else|for|while|repeat|do|catch|defer)$/;

function scanSwift(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const at = (offset = 0) => source[i + offset] ?? "";

  const readString = (): string => {
    let hashes = 0;
    while (at() === "#") hashes++, i++;
    const multi = source.startsWith('"""', i);
    i += multi ? 3 : 1;
    const close = (multi ? '"""' : '"') + "#".repeat(hashes);
    const escape = "\\" + "#".repeat(hashes);
    let value = "";
    while (i < source.length && !source.startsWith(close, i)) {
      if (!multi && at() === "\n") return value;
      if (!source.startsWith(escape, i)) {
        if (at() === "\n") line++;
        value += source[i++];
        continue;
      }
      i += escape.length;
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
      else value += /[ntr]/.test(c) ? " " : c === "0" ? "" : c;
    }
    i += close.length;
    return multi ? dedent(value) : value;
  };

  // Runs to the ")" closing an interpolation, stepping over strings inside it.
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
    if (c === "\n") line++, i++;
    else if (/\s/.test(c)) i++;
    else if (c === "/" && at(1) === "/") while (i < source.length && at() !== "\n") i++;
    else if (c === "/" && at(1) === "*") {
      for (let depth = 0; i < source.length; ) {
        if (at() === "/" && at(1) === "*") depth++, (i += 2);
        else if (at() === "*" && at(1) === "/") {
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

export interface Declaration {
  name: string;
  type?: boolean;
  returnsString?: boolean;
  preview?: boolean;
}

/** Tokens plus their nesting: parent[i] is the bracket around token i, match pairs brackets. */
export class SwiftSource {
  readonly tokens: Token[];
  readonly parent: number[] = [];
  readonly match: number[] = [];

  constructor(source: string) {
    this.tokens = scanSwift(source);
    const stack: number[] = [];
    this.tokens.forEach((token, index) => {
      this.parent[index] = stack.length ? stack[stack.length - 1] : -1;
      if (token.kind !== "punct") return;
      if (OPEN[token.text]) stack.push(index);
      else if (stack.length && OPEN[this.text(stack[stack.length - 1])] === token.text) {
        const open = stack.pop()!;
        this.match[open] = index;
        this.match[index] = open;
      }
    });
  }

  text(index: number): string {
    return this.tokens[index]?.text ?? "";
  }

  isId(index: number): boolean {
    return this.tokens[index]?.kind === "id";
  }

  /** The call whose "(" is at open: "Button", "logger.info", or ".help" for a modifier. */
  callee(open: number): string {
    const parts: string[] = [];
    let j = open - 1;
    while (this.isId(j)) {
      parts.unshift(this.text(j));
      if (this.text(j - 1) !== ".") break;
      j -= 2;
      if (!this.isId(j)) return "." + parts.join(".");
    }
    return parts.join(".");
  }

  /** Which argument of the call at open the token at index sits in. */
  argument(open: number, index: number): { label?: string; position: number } {
    let position = 0;
    let start = open + 1;
    for (let j = open + 1; j < index; j++) if (this.parent[j] === open && this.text(j) === ",") position++, (start = j + 1);
    const labelled = this.isId(start) && this.text(start + 1) === ":";
    return labelled ? { label: this.text(start), position } : { position };
  }

  hasArgument(open: number, label: string): boolean {
    for (let j = open + 1; j < (this.match[open] ?? open); j++) if (this.parent[j] === open && this.text(j) === label && this.text(j + 1) === ":") return true;
    return false;
  }

  /** What owns a "{": the call before it, and the label of a trailing closure such as label: { }. */
  owner(brace: number): { name: string; label?: string; afterParen?: boolean } {
    const before = brace - 1;
    if (this.text(before) === ")" && this.match[before] !== undefined) return { name: this.callee(this.match[before]).replace(/^\./, ""), afterParen: true };
    if (this.text(before) !== ":" || !this.isId(before - 1)) return { name: this.isId(before) ? this.text(before) : "" };
    const label = this.text(before - 1);
    if (this.text(before - 2) === "}" && this.match[before - 2] !== undefined) return { ...this.owner(this.match[before - 2]), label };
    const open = this.parent[brace];
    return { name: open >= 0 && this.text(open) === "(" ? this.callee(open).replace(/^\./, "") : "", label };
  }

  /** The declaration a "{" opens: var title: String {, func delete() -> String {, enum X {. */
  declaration(brace: number): Declaration | undefined {
    let returnsString = false;
    for (const j of this.statementBefore(brace)) {
      const t = this.text(j);
      if (CONTROL.test(t)) return undefined;
      if (/^(String|LocalizedStringKey|LocalizedStringResource)$/.test(t)) returnsString = true;
      if (t === "PreviewProvider" || t === "#Preview") return { name: t, preview: true };
      // A binding in a condition, such as if let x = ..., declares nothing around the brace.
      if (/^(var|let)$/.test(t) && /^(if|guard|while|case|,)$/.test(this.text(j - 1))) return undefined;
      if (/^(var|let|func)$/.test(t)) return { name: this.text(j + 1), returnsString };
      if (/^(enum|struct|class|extension|actor|protocol)$/.test(t)) {
        const header = this.tokens.slice(j, brace).map((token) => token.text);
        return { name: this.text(j + 1), type: true, preview: header.includes("PreviewProvider") };
      }
    }
    return undefined;
  }

  /** Tokens at the same depth before index, back to the previous brace or ;, nearest first. */
  *statementBefore(index: number, limit = 40): Generator<number> {
    const level = this.parent[index];
    for (let j = index - 1, steps = 0; j >= 0 && steps < limit; j--, steps++) {
      if (this.parent[j] !== level) continue;
      if (this.text(j) === "{" || this.text(j) === "}" || this.text(j) === ";") return;
      yield j;
    }
  }

  /** Every "{" around index, innermost first. */
  braces(index: number): number[] {
    const found: number[] = [];
    for (let j = this.parent[index]; j >= 0; j = this.parent[j]) if (this.text(j) === "{") found.push(j);
    return found;
  }

  /** The modifiers chained after a call's ")", past any trailing closures. */
  modifiers(close: number): { name: string; args: string }[] {
    const found: { name: string; args: string }[] = [];
    for (let j = close + 1; ; ) {
      if (this.text(j) === "{" && this.match[j] !== undefined) j = this.match[j] + 1;
      else if (this.isId(j) && this.text(j + 1) === ":" && this.text(j + 2) === "{" && this.match[j + 2] !== undefined) j = this.match[j + 2] + 1;
      else if (this.text(j) === "." && this.isId(j + 1) && this.text(j + 2) === "(" && this.match[j + 2] !== undefined) {
        const args = this.tokens.slice(j + 3, this.match[j + 2]).map((token) => token.text).join("");
        found.push({ name: this.text(j + 1), args });
        j = this.match[j + 2] + 1;
      } else return found;
    }
  }

  /** The first string argument of the call ending at close, such as an alert's title. */
  firstString(close: number): string | undefined {
    const open = this.match[close];
    for (let j = open + 1; j < close; j++) if (this.tokens[j].kind === "str" && this.parent[j] === open) return this.tokens[j].value;
    return undefined;
  }

  /** Whether any string inside the brace matches, such as instructions for a language model. */
  contains(brace: number, pattern: RegExp): boolean {
    return this.tokens.slice(brace, this.match[brace]).some((token) => token.kind === "str" && pattern.test(token.value!));
  }
}
