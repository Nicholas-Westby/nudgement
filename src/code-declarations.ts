import type { UnitKind } from "./code";

const MODIFIERS =
  "(?:(?:export|default|declare|public|private|protected|internal|fileprivate|open|static|final|sealed|abstract|partial|async|override|virtual|readonly|unsafe|extern|new|synchronized|suspend|inline|operator|infix|required|convenience|lazy|mutating|nonisolated|const|pub(?:\\([^)]*\\))?|@[\\w.]+(?:\\([^)]*\\))?)\\s+)*";

// Tried in order against a unit's first code line.
const DECLARATIONS: [RegExp, UnitKind][] = [
  [new RegExp(`^${MODIFIERS}(?:namespace|module)\\s+(?<name>[\\w.:]+)`), "namespace"],
  [
    new RegExp(`^${MODIFIERS}(?:class|struct|record|object|actor|extension|trait|protocol)\\s+(?<name>[\\w.]+)`),
    "class",
  ],
  [/^impl(?:<[^>]*>)?\s+(?:[\w:<>]+\s+for\s+)?(?<name>[\w:]+)/, "class"],
  [new RegExp(`^${MODIFIERS}(?:interface|enum|type|typealias)\\s+(?<name>[\\w$]+)`), "type"],
  [new RegExp(`^${MODIFIERS}function\\s*\\*?\\s*(?<name>[\\w$]+)?`), "function"],
  [
    new RegExp(
      `^${MODIFIERS}(?:def|fn|func|fun|sub|proc)\\s+(?:<[^>]*>\\s*)?(?:\\([^)]*\\)\\s*)?(?:[\\w.]+\\.)?(?<name>[\\w$?!]+)`,
    ),
    "function",
  ],
  [
    new RegExp(
      `^${MODIFIERS}(?:const|let|var|val)\\s+(?<name>[\\w$]+)[^=]*=\\s*(?:async\\s+)?(?:function\\b|\\([^)]*\\)\\s*(?::[^=]+)?=>|[\\w$]+\\s*=>)`,
    ),
    "function",
  ],
  [
    new RegExp(`^${MODIFIERS}(?:const|let|var|val|static)\\s+(?:[\\w<>[\\],.?]+\\s+)?(?<name>[\\w$]+)\\s*[:=;]`),
    "value",
  ],
  [/^(?:function\s+)?(?<name>[\w-]+)\s*\(\)\s*\{?\s*$/, "function"],
  [/^(?<name>[A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=/, "value"],
  [/^(?<name>module\.exports|exports\.\w+)\s*=/, "value"],
];

// Members of a class or namespace that have no keyword of their own.
const MEMBERS: [RegExp, UnitKind][] = [
  // C#, Java, Kotlin: modifiers, then a return type, then name(
  [
    /^(?:(?:public|private|protected|internal|static|async|override|virtual|abstract|sealed|final|synchronized|extern|unsafe|new|partial|readonly)\s+)+(?:[\w<>[\],.?]+\s+)*?(?<name>\w+)\s*(?:<[^>]*>)?\s*\(/,
    "function",
  ],
  // TypeScript and JavaScript methods, getters and setters
  [
    /^(?:(?:public|private|protected|static|async|override|readonly|abstract|declare|get|set)\s+)*\*?\s*(?<name>#?[\w$]+)\s*(?:<[^>]*>)?\s*\(/,
    "function",
  ],
  // Arrow-function properties: handle = async () => {
  [
    /^(?:(?:public|private|protected|static|readonly)\s+)*(?<name>#?[\w$]+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*(?::[^=]+)?=>/,
    "function",
  ],
  // C# properties: public string Name { get; set; } or => expression
  [
    /^(?:(?:public|private|protected|internal|static|virtual|override|abstract|new|readonly|required)\s+)+[\w<>[\],.?]+\s+(?<name>\w+)\s*(\{|=>)/,
    "value",
  ],
  // Swift initializers and computed properties
  [
    /^(?:(?:public|private|internal|fileprivate|open|convenience|required|override)\s+)*(?<name>init|deinit)\b/,
    "function",
  ],
  [
    /^(?:(?:public|private|internal|fileprivate|open|static|final|override|@[\w.]+)\s+)*var\s+(?<name>\w+)\s*:[^=]*\{\s*$/,
    "function",
  ],
];

const NOT_A_NAME = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "await",
  "throw",
  "new",
  "typeof",
  "super",
  "this",
  "else",
  "do",
  "try",
  "yield",
  "delete",
  "void",
  "with",
]);

// Swift's setter access, as in `public internal(set) var`, and `nonisolated(unsafe)` read as calls.
const SWIFT_ACCESS = /\b(?:public|private|internal|fileprivate|open|package)\(set\)\s+|\bnonisolated\(unsafe\)\s+/g;

export function declaration(trimmed: string, member: boolean): { name?: string; kind: UnitKind } | undefined {
  const line = trimmed.replace(SWIFT_ACCESS, "");
  for (const [pattern, kind] of member ? [...MEMBERS, ...DECLARATIONS] : DECLARATIONS) {
    const match = pattern.exec(line);
    if (!match) continue;
    const name = match.groups?.name;
    if (name && NOT_A_NAME.has(name)) continue;
    return { name, kind };
  }
  return undefined;
}
