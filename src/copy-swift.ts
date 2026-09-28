/**
 * Pulls the user-facing strings out of a SwiftUI (or AppKit) Swift file. A
 * string's role comes from the call it is handed to (Button("…") is a button,
 * .help("…") a tooltip) and from the closures around that call (a Label inside
 * a Menu is a menu item). Strings outside any call are kept only when the
 * property or function that returns them is named for copy, such as
 * `var errorDescription` or `static func title(...)`.
 */

import type { CopyRole, CopyString } from "./copy-extract";
import { SwiftSource } from "./swift-source";

// Calls whose first argument is copy, and its role.
const CALLS: Record<string, CopyRole> = {
  Text: "text",
  Button: "button",
  Link: "link",
  Menu: "heading",
  CommandMenu: "heading",
  Tab: "button",
  Label: "label",
  Toggle: "label",
  Picker: "label",
  Stepper: "label",
  DatePicker: "label",
  ColorPicker: "label",
  LabeledContent: "label",
  TextField: "label",
  SecureField: "label",
  ProgressView: "text",
  Section: "heading",
  GroupBox: "heading",
  DisclosureGroup: "heading",
  ContentUnavailableView: "heading",
  Window: "title",
  WindowGroup: "title",
  ".help": "tooltip",
  ".navigationTitle": "title",
  ".navigationSubtitle": "text",
  // What VoiceOver speaks, like a web page's alt text, where capitals go unheard.
  ".accessibilityLabel": "alt",
  ".accessibilityHint": "text",
  ".accessibilityValue": "text",
  ".alert": "heading",
  ".confirmationDialog": "heading",
  ".badge": "text",
};
// Labelled arguments of a custom view that carry copy.
const ARGUMENT_LABELS: Record<string, CopyRole> = {
  prompt: "placeholder",
  placeholder: "placeholder",
  message: "text",
  description: "text",
  help: "tooltip",
  hint: "text",
  caption: "text",
  subtitle: "text",
  explanation: "text",
  title: "title",
  heading: "heading",
  label: "label",
  error: "error",
};
// Calls that pass a string through to what is around them, such as String(localized:).
const TRANSPARENT = new Set(["String", "LocalizedStringKey", "LocalizedStringResource", "NSLocalizedString", "Text"]);
const MENUS = new Set(["Menu", "contextMenu", "commands", "CommandMenu", "CommandGroup", "MenuBarExtra"]);
const SKIP_CALLS = /^(print|debugPrint|dump|NSLog|os_log|fatalError|precondition|preconditionFailure|assert|assertionFailure|Logger|XCT\w+|#expect|#require|URL|Image|NSImage|Color|UserDefaults|Notification\.Name|UTType)$|^(logger|log|Log|signposter)\b|(^|\.)(log|logger|Log|Logger)\.\w+$/;
const SKIP_LABELS = new Set(["systemImage", "systemName", "image", "named", "forKey", "key", "id", "identifier", "subsystem", "category", "tableName", "bundle", "comment", "forResource", "withExtension", "ofType", "string", "destination", "debugDescription"]);
const HEADING_FONTS = /^\.(largeTitle|title|title2|title3|headline)$/;
const RED = /^\.?red$|^Color\.red$/;
const FAILURE = /\b(couldn['’]t|could not|can['’]t|cannot|failed|went wrong|error|isn['’]t available|wasn['’]t|didn['’]t|not found|invalid)\b/i;
// A message that reports a failure, narrower than FAILURE since "This can't be undone" is not one.
const FAILED = /\b(couldn['’]t|could not|failed|went wrong|isn['’]t available|not found)\b/i;
const SENTENCE_END = /[.?!…]$/;
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
// NSAlert's two texts, whose words mislead.
const WHOLE_NAMES: Record<string, CopyRole> = { messageText: "heading", informativeText: "text" };
const NOT_COPY_WORD = /^(key|id|identifier|url|path|symbol|image|icon|pattern|regex|query|endpoint|host|scheme|format|mime|domain|subsystem|category|debug|http|json|sql|log|logger)s?$/;
// Instructions to a language model, which the app sends but never shows.
const MODEL_PROMPT = /^You are (a|an|the|reading|marking|choosing)\b|\bReply with\b|\bJSON\b/;
// Debug output such as "Binding(id: {id})" or "article={title}".
const CODE_LIKE = /^[A-Z]\w*\(\w+:|\b\w+=\{/;
// Keys and ids such as "com.example.app" or "search-field".
const IDENTIFIER = /^[\p{L}\d]+([._-][\p{L}\d]+)+$/u;
const PATH_OR_URL = /^\w+:\/\/|^[.~\/]|\S\/\S/;
const FORMAT = /%(\d+\$)?(ll|l|h)?[@dfsiuxX]|%\.\d+f/g;

function roleFromName(name: string): CopyRole | undefined {
  if (WHOLE_NAMES[name]) return WHOLE_NAMES[name];
  const words = name.split(/(?=[A-Z][a-z])/).map((word) => word.toLowerCase());
  if (NOT_COPY_WORD.test(words[words.length - 1]) || words.some((word) => /^(debug|http|json|sql|log|logger)$/.test(word))) return undefined;
  return NAMES.find(([pattern]) => words.some((word) => pattern.test(word)))?.[1];
}

export function extractSwiftCopy(path: string, source: string): CopyString[] {
  if (/(^|\/)\w*Tests?\/|Tests?\.swift$/.test(path)) return [];
  const swift = new SwiftSource(source);
  const found: CopyString[] = [];
  swift.tokens.forEach((token, index) => {
    if (token.kind !== "str") return;
    const role = roleOf(swift, index);
    if (!role) return;
    const clean = token.value!.replace(FORMAT, "{…}").replace(/\s+/g, " ").trim();
    if (!/\p{L}{2,}/u.test(clean.replace(/\{[^}]*\}/g, "")) || /^\w+:\/\//.test(clean) || IDENTIFIER.test(clean) || CODE_LIKE.test(clean)) return;
    found.push({ text: clean, role, line: token.line });
  });
  return found;
}

function roleOf(swift: SwiftSource, index: number): CopyRole | undefined {
  const text = (j: number) => swift.text(j);
  const { parent, match } = swift;
  // Climb out through calls that pass the string on, such as String(localized:) or Text(...).
  let at = index;
  let open = parent[at];
  let inText = false;
  while (open >= 0 && text(open) === "(") {
    const name = swift.callee(open);
    if (!TRANSPARENT.has(name) || inText) break;
    if (SKIP_LABELS.has(swift.argument(open, at).label ?? "")) return undefined;
    inText ||= name === "Text";
    at = open - 1;
    while (swift.isId(at - 1) || text(at - 1) === ".") at--;
    open = parent[open];
  }
  for (let j = open; j >= 0; j = parent[j]) if (text(j) === "(" && SKIP_CALLS.test(swift.callee(j).replace(/^\./, ""))) return undefined;
  if (open >= 0 && text(open) === "[") return undefined;
  if (!inText && !(open >= 0 && text(open) === "(")) return namedRole(swift, index);

  const call = inText ? "Text" : swift.callee(open);
  const inCall = open >= 0 && text(open) === "(" ? roleInCall(swift, swift.callee(open), swift.argument(open, at), open) : undefined;
  let role = inCall ?? (inText ? "text" : undefined);
  if (!role) return undefined;
  const value = swift.tokens[index].value!;
  if (/^\.(alert|confirmationDialog)$/.test(swift.callee(open)) && role === "heading" && FAILURE.test(value)) return "error";

  let close = inText ? undefined : match[open];
  if (inText) for (let j = parent[index]; j >= 0 && close === undefined; j = parent[j]) if (text(j) === "(" && swift.callee(j) === "Text") close = match[j];
  const chain = close !== undefined ? swift.modifiers(close) : [];
  if (role === "text" && call === "Text" && chain.some((m) => m.name === "font" && HEADING_FONTS.test(m.args))) role = "heading";
  if (chain.some((m) => /^foreground(Style|Color)$/.test(m.name) && RED.test(m.args))) role = "error";
  if ((role === "label" || role === "text") && chain.some((m) => m.name === "accessibilityIdentifier" && /menu/i.test(m.args))) role = call === "Toggle" ? "option" : "button";

  const placed = closureRole(swift, open, role, call);
  if (placed === "label" && call === "Label" && SENTENCE_END.test(value.trim())) return "text";
  // A text field with no prompt shows its title as the placeholder, except in a form.
  const inForm = swift.braces(open).some((brace) => /^(Form|Section)$/.test(swift.owner(brace).name));
  if (placed === "label" && /^(TextField|SecureField)$/.test(call) && !swift.hasArgument(open, "prompt") && !inForm) return "placeholder";
  return placed;
}

// The role a call gives an argument, or undefined when the argument is not copy.
function roleInCall(swift: SwiftSource, name: string, arg: { label?: string; position: number }, open: number): CopyRole | undefined {
  const { label, position } = arg;
  if (label && SKIP_LABELS.has(label)) return undefined;
  if (label === "prompt") return "placeholder";
  if (label === "withTitle") return "button";
  if (label === "message" && /^\.(alert|confirmationDialog)$/.test(name)) return "text";
  if (label === "header") return "heading";
  if (label === "footer") return "text";
  if (label === "description" && name === "ContentUnavailableView") return "text";
  if (CALLS[name]) return (position === 0 && (!label || label === "verbatim")) || label === "label" || label === "title" ? CALLS[name] : undefined;
  // A custom view's labelled arguments, such as RenameShelfSheet(title:, confirmLabel:).
  if (label && /^[A-Z]/.test(name) && inViewCode(swift, open)) return ARGUMENT_LABELS[label] ?? roleFromName(label);
  return undefined;
}

// Inside a view's body, a function returning some View, or a View type.
function inViewCode(swift: SwiftSource, index: number): boolean {
  return swift.braces(index).some((brace) => [...swift.statementBefore(brace)].some((j) => /^(View|Scene|Commands|@ViewBuilder)$/.test(swift.text(j))));
}

// Where the closures around a view put it: in a menu, a button's label, a picker...
function closureRole(swift: SwiftSource, index: number, role: CopyRole, call: string): CopyRole | undefined {
  const around = swift.text(index) === "{" ? [index, ...swift.braces(index)] : swift.braces(index);
  for (const brace of around) {
    const { name, label, afterParen } = swift.owner(brace);
    const decl = swift.declaration(brace);
    if (decl?.preview || name === "#Preview") return undefined;
    if ((name === "Button" || name === "Link") && (label === "label" || (afterParen && !label))) return name === "Link" ? "link" : "button";
    if (name === "Menu" && label === "label") return "button";
    // A toggle in a menu is a checkable item, a choice rather than an action.
    if (MENUS.has(name) && !label) return call === "Toggle" ? "option" : call === "Text" || role === "label" || role === "button" ? "button" : role;
    if (name === "Picker" && !label && call === "Text") return "option";
    if (name === "ContentUnavailableView") return label === "description" ? "text" : label === "actions" ? role : "heading";
    if (name === "Section" && label) return label === "header" ? "heading" : "text";
    // Label { Text("…") } is a label unless a button or menu further out makes it one.
    if (name === "Label" && (!label || label === "title") && call === "Text") role = "label";
    if (/^(alert|confirmationDialog)$/.test(name) && label === "message") {
      const actions = swift.match[brace - 3];
      const hasTitle = swift.text(brace - 3) === "}" && actions !== undefined && swift.text(actions - 1) === ")";
      const title = hasTitle ? swift.firstString(actions - 1) : undefined;
      return title && FAILURE.test(title) ? "error" : "text";
    }
    if (decl?.type && /Menu|Commands/.test(decl.name) && (role === "label" || call === "Text")) return call === "Toggle" ? "option" : "button";
  }
  return role;
}

// A string no call claims: kept when the property or function returning it is named for copy.
function namedRole(swift: SwiftSource, index: number): CopyRole | undefined {
  const value = swift.tokens[index].value!;
  const braces = swift.braces(index);
  const decls = braces.map((brace) => ({ brace, decl: swift.declaration(brace) }));
  if (MODEL_PROMPT.test(value) || decls.some(({ brace, decl }) => decl?.preview || (decl?.type && swift.contains(brace, MODEL_PROMPT)))) return undefined;
  if ((!/\s/.test(value.trim()) && !/^\p{Lu}/u.test(value)) || PATH_OR_URL.test(value)) return undefined;

  const role = statementRole(swift, index) ?? memberRole(decls.map(({ decl }) => decl));
  if (role === null) return undefined;
  if (role) return role === "text" && FAILED.test(value) ? "error" : role;
  // Otherwise only a whole sentence, such as a status message kept in a constant.
  if (SENTENCE_END.test(value.trim()) && /^\p{Lu}\S*\s\S+\s\S/u.test(value)) return FAILED.test(value) ? "error" : "text";
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

function memberRole(decls: (ReturnType<SwiftSource["declaration"]>)[]): CopyRole | null | undefined {
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
