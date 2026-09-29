import type { CopyRole } from "./copy-extract";
import { FAILURE, roleFromName } from "./swift-copy-names";
import type { SwiftSource } from "./swift-source";

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
  // Accessibility text is spoken, so visual capitalization rules do not apply.
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
export const TRANSPARENT = new Set([
  "String",
  "LocalizedStringKey",
  "LocalizedStringResource",
  "NSLocalizedString",
  "Text",
]);

const MENUS = new Set(["Menu", "contextMenu", "commands", "CommandMenu", "CommandGroup", "MenuBarExtra"]);

export const SKIP_CALLS =
  /^(print|debugPrint|dump|NSLog|os_log|fatalError|precondition|preconditionFailure|assert|assertionFailure|Logger|XCT\w+|#expect|#require|URL|Image|NSImage|Color|UserDefaults|Notification\.Name|UTType)$|^(logger|log|Log|signposter)\b|(^|\.)(log|logger|Log|Logger)\.\w+$/;

export const SKIP_LABELS = new Set([
  "systemImage",
  "systemName",
  "image",
  "named",
  "forKey",
  "key",
  "id",
  "identifier",
  "subsystem",
  "category",
  "tableName",
  "bundle",
  "comment",
  "forResource",
  "withExtension",
  "ofType",
  "string",
  "destination",
  "debugDescription",
]);

export function roleInCall(
  swift: SwiftSource,
  name: string,
  arg: { label?: string; position: number },
  open: number,
): CopyRole | undefined {
  const { label, position } = arg;
  if (label && SKIP_LABELS.has(label)) return undefined;
  if (label === "prompt") return "placeholder";
  if (label === "withTitle") return "button";
  if (label === "message" && /^\.(alert|confirmationDialog)$/.test(name)) return "text";
  if (label === "header") return "heading";
  if (label === "footer") return "text";
  if (label === "description" && name === "ContentUnavailableView") return "text";
  if (CALLS[name])
    return (position === 0 && (!label || label === "verbatim")) || label === "label" || label === "title"
      ? CALLS[name]
      : undefined;
  // A custom view's labelled arguments, such as RenameShelfSheet(title:, confirmLabel:).
  if (label && /^[A-Z]/.test(name) && inViewCode(swift, open)) return ARGUMENT_LABELS[label] ?? roleFromName(label);
  return undefined;
}

function inViewCode(swift: SwiftSource, index: number): boolean {
  return swift
    .braces(index)
    .some((brace) =>
      [...swift.statementBefore(brace)].some((j) => /^(View|Scene|Commands|@ViewBuilder)$/.test(swift.text(j))),
    );
}

export function closureRole(swift: SwiftSource, index: number, role: CopyRole, call: string): CopyRole | undefined {
  const around = swift.text(index) === "{" ? [index, ...swift.braces(index)] : swift.braces(index);
  for (const brace of around) {
    const { name, label, afterParen } = swift.owner(brace);
    const decl = swift.declaration(brace);
    if (decl?.preview || name === "#Preview") return undefined;
    if ((name === "Button" || name === "Link") && (label === "label" || (afterParen && !label)))
      return name === "Link" ? "link" : "button";
    if (name === "Menu" && label === "label") return "button";
    // A toggle in a menu is a checkable item, a choice rather than an action.
    if (MENUS.has(name) && !label)
      return call === "Toggle" ? "option" : call === "Text" || role === "label" || role === "button" ? "button" : role;
    if (name === "Picker" && !label && call === "Text") return "option";
    if (name === "ContentUnavailableView")
      return label === "description" ? "text" : label === "actions" ? role : "heading";
    if (name === "Section" && label) return label === "header" ? "heading" : "text";
    // Label { Text("…") } is a label unless a button or menu further out makes it one.
    if (name === "Label" && (!label || label === "title") && call === "Text") role = "label";
    if (/^(alert|confirmationDialog)$/.test(name) && label === "message") {
      const actions = swift.match[brace - 3];
      const hasTitle = swift.text(brace - 3) === "}" && actions !== undefined && swift.text(actions - 1) === ")";
      const title = hasTitle ? swift.firstString(actions - 1) : undefined;
      return title && FAILURE.test(title) ? "error" : "text";
    }
    if (decl?.type && /Menu|Commands/.test(decl.name) && (role === "label" || call === "Text"))
      return call === "Toggle" ? "option" : "button";
  }
  return role;
}
