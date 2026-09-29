import type { CopyRole } from "./copy-extract";
import { closureRole, roleInCall, SKIP_CALLS, SKIP_LABELS, TRANSPARENT } from "./swift-copy-calls";
import { FAILURE, namedRole, SENTENCE_END } from "./swift-copy-names";
import type { SwiftSource } from "./swift-source";

const HEADING_FONTS = /^\.(largeTitle|title|title2|title3|headline)$/;

const RED = /^\.?red$|^Color\.red$/;

export function roleOf(swift: SwiftSource, index: number): CopyRole | undefined {
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
  for (let j = open; j >= 0; j = parent[j])
    if (text(j) === "(" && SKIP_CALLS.test(swift.callee(j).replace(/^\./, ""))) return undefined;
  if (open >= 0 && text(open) === "[") return undefined;
  if (!inText && !(open >= 0 && text(open) === "(")) return namedRole(swift, index);

  const call = inText ? "Text" : swift.callee(open);
  const inCall =
    open >= 0 && text(open) === "(" ? roleInCall(swift, swift.callee(open), swift.argument(open, at), open) : undefined;
  let role = inCall ?? (inText ? "text" : undefined);
  if (!role) return undefined;
  const value = swift.tokens[index].value!;
  if (/^\.(alert|confirmationDialog)$/.test(swift.callee(open)) && role === "heading" && FAILURE.test(value))
    return "error";

  let close = inText ? undefined : match[open];
  if (inText)
    for (let j = parent[index]; j >= 0 && close === undefined; j = parent[j])
      if (text(j) === "(" && swift.callee(j) === "Text") close = match[j];
  const chain = close !== undefined ? swift.modifiers(close) : [];
  if (role === "text" && call === "Text" && chain.some((m) => m.name === "font" && HEADING_FONTS.test(m.args)))
    role = "heading";
  if (chain.some((m) => /^foreground(Style|Color)$/.test(m.name) && RED.test(m.args))) role = "error";
  if (
    (role === "label" || role === "text") &&
    chain.some((m) => m.name === "accessibilityIdentifier" && /menu/i.test(m.args))
  )
    role = call === "Toggle" ? "option" : "button";

  const placed = closureRole(swift, open, role, call);
  if (placed === "label" && call === "Label" && SENTENCE_END.test(value.trim())) return "text";
  // A text field with no prompt shows its title as the placeholder, except in a form.
  const inForm = swift.braces(open).some((brace) => /^(Form|Section)$/.test(swift.owner(brace).name));
  if (placed === "label" && /^(TextField|SecureField)$/.test(call) && !swift.hasArgument(open, "prompt") && !inForm)
    return "placeholder";
  return placed;
}
export { CODE_LIKE, FORMAT, IDENTIFIER } from "./swift-copy-names";
