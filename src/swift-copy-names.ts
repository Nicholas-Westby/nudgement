import type { CopyRole } from "./copy-extract";
import type { SwiftSource } from "./swift-source";

export const FAILURE =
  /\b(couldn['’]t|could not|can['’]t|cannot|failed|went wrong|error|isn['’]t available|wasn['’]t|didn['’]t|not found|invalid)\b/i;

// A message that reports a failure, narrower than FAILURE since "This can't be undone" is not one.
const FAILED = /\b(couldn['’]t|could not|failed|went wrong|isn['’]t available|not found)\b/i;

export const SENTENCE_END = /[.?!…]$/;

// Matched against each word of a camelCase name, in this order.
const NAMES: [RegExp, CopyRole][] = [
  [/^accessibility$/, "alt"],
  [/^(recovery|suggestion)$/, "text"],
  [/^(error|failure|problem|warning)s?$/, "error"],
  [/^(help|tooltip)$/, "tooltip"],
  [/^(button|action|confirm|menu|command)s?$/, "button"],
  [/^(question|heading|header|headline)s?$/, "heading"],
  [/^(placeholder|prompt)s?$/, "placeholder"],
  [/^titles?$/, "title"],
  [/^labels?$/, "label"],
  [/^(message|explanation|summary|details?|hint|caption|subtitle|informative|notice|status)s?$/, "text"],
];

// NSAlert uses informativeText and messageText for two distinct copy roles.
const WHOLE_NAMES: Record<string, CopyRole> = { messageText: "heading", informativeText: "text" };

const NOT_COPY_WORD =
  /^(key|id|identifier|url|path|symbol|image|icon|pattern|regex|query|endpoint|host|scheme|format|mime|domain|subsystem|category|debug|http|json|sql|log|logger)s?$/;

// Instructions to a language model, which the app sends but never shows.
const MODEL_PROMPT = /^You are (a|an|the|reading|marking|choosing)\b|\bReply with\b|\bJSON\b/;

// Debug output such as "Binding(id: {id})" or "article={title}".
export const CODE_LIKE = /^[A-Z]\w*\(\w+:|\b\w+=\{/;

// Keys and ids such as "com.example.app" or "search-field".
export const IDENTIFIER = /^[\p{L}\d]+([._-][\p{L}\d]+)+$/u;

const PATH_OR_URL = /^\w+:\/\/|^[.~/]|\S\/\S/;

export const FORMAT = /%(\d+\$)?(ll|l|h)?[@dfsiuxX]|%\.\d+f/g;

export function roleFromName(name: string): CopyRole | undefined {
  if (WHOLE_NAMES[name]) return WHOLE_NAMES[name];
  const words = name.split(/(?=[A-Z][a-z])/).map((word) => word.toLowerCase());
  if (
    NOT_COPY_WORD.test(words[words.length - 1]) ||
    words.some((word) => /^(debug|http|json|sql|log|logger)$/.test(word))
  )
    return undefined;
  return NAMES.find(([pattern]) => words.some((word) => pattern.test(word)))?.[1];
}

// Unclaimed strings need a copy-related name; sentence-like constants are a fallback.
export function namedRole(swift: SwiftSource, index: number): CopyRole | undefined {
  const value = swift.tokens[index].value!;
  const braces = swift.braces(index);
  const decls = braces.map((brace) => ({ brace, decl: swift.declaration(brace) }));
  if (
    MODEL_PROMPT.test(value) ||
    decls.some(({ brace, decl }) => decl?.preview || (decl?.type && swift.contains(brace, MODEL_PROMPT)))
  )
    return undefined;
  if ((!/\s/.test(value.trim()) && !/^\p{Lu}/u.test(value)) || PATH_OR_URL.test(value)) return undefined;

  const role = statementRole(swift, index) ?? memberRole(decls.map(({ decl }) => decl));
  if (role === null) return undefined;
  if (role) return role === "text" && FAILED.test(value) ? "error" : role;
  if (SENTENCE_END.test(value.trim()) && /^\p{Lu}\S*\s\S+\s\S/u.test(value))
    return FAILED.test(value) ? "error" : "text";
  return undefined;
}

// The name the string is assigned to, as in let title = "…" or alert.messageText = "…".
// Null when it is assigned to a name that is not copy, or is an enum's raw value.
function statementRole(swift: SwiftSource, index: number): CopyRole | null | undefined {
  const level = swift.parent[index];
  for (let j = index - 1, steps = 0; j >= 0 && steps < 40; j--, steps++) {
    if (swift.parent[j] !== level) continue;
    const t = swift.text(j);
    if (t === "=" && swift.isId(j - 1)) return roleFromName(swift.text(j - 1)) ?? null;
    if (/^(let|var)$/.test(t)) return roleFromName(swift.text(j + 1)) ?? null;
    if (t === "case" && swift.isId(j + 1) && swift.text(j + 2) === "=") return null;
    if (t === "}" && swift.match[j] !== undefined) j = swift.match[j];
    else if (t === "{" || t === ";") return undefined;
  }
  return undefined;
}

function memberRole(decls: ReturnType<SwiftSource["declaration"]>[]): CopyRole | null | undefined {
  const member = decls.find((decl) => decl && !decl.type);
  const typeName = decls.find((decl) => decl?.type)?.name;
  if (!member) return undefined;
  const role = roleFromName(member.name);
  const typeRole = typeName ? roleFromName(typeName) : undefined;
  // A title in a type named for menus, such as PlaceMenuTitle, is a menu item.
  if ((role === "title" || role === "label") && typeRole === "button") return "button";
  // The message of an error type, such as UpdateInstallError.message, is an error.
  if (role === "text" && typeRole === "error") return "error";
  if (role) return role;
  if (!member.returnsString || !typeRole) return undefined;
  // A type named Prompt is a dialog, and what it returns is its text.
  return typeRole === "placeholder" || typeRole === "tooltip" ? "text" : typeRole;
}
