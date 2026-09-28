/**
 * Pulls the user-facing strings out of a TSX or TypeScript file (Swift views
 * go to copy-swift.ts), using the
 * TypeScript parser so JSX is read the way the compiler reads it. Text split
 * across expressions and inline tags becomes one string with placeholders:
 * <p>{count} bikes left</p> gives "{count} bikes left". Each string gets a
 * role from where it sits (heading, button, link, label, error...), since the
 * rules for a button differ from the rules for an error.
 */

import ts from "typescript5";
import { extractSwiftCopy } from "./copy-swift";

export type CopyRole = "title" | "heading" | "button" | "link" | "label" | "placeholder" | "alt" | "error" | "option" | "tooltip" | "text";

export interface CopyString {
  text: string;
  role: CopyRole;
  line: number;
}

// Tags whose text runs on into the surrounding sentence.
const INLINE = new Set(["strong", "em", "b", "i", "span", "small", "code", "time", "abbr", "mark", "sub", "sup", "br", "kbd", "q", "s", "u"]);
const ATTRIBUTES: Record<string, CopyRole> = { title: "text", placeholder: "placeholder", "aria-label": "label", alt: "alt", label: "label" };
// Props that carry text on components such as <Field hint="..."> or <Layout title="...">.
const COMPONENT_PROPS: Record<string, CopyRole> = {
  title: "title",
  heading: "heading",
  subtitle: "text",
  label: "label",
  hint: "text",
  help: "text",
  helpText: "text",
  description: "text",
  caption: "text",
  message: "text",
  error: "error",
  emptyText: "text",
  placeholder: "placeholder",
  submitLabel: "button",
  buttonLabel: "button",
  cta: "button",
};
const SENTENCE = /^\p{Lu}[^\n]*\s\S/u;
const NOT_COPY = /^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH|PRAGMA|BEGIN)\b|^\w+:\/\/|^[.\/]/;
const ERRORISH = /\b(invalid|too (long|short|many|few)|can't|cannot|must|required|not allowed|out of range|unknown|already|no longer|try again|failed)\b/i;
const SKIP_CALLS = /^(console|logger|log|debug)\.|^(assert|expect|describe|it|test|require|import)$/;
const MESSAGE_KEYS: Record<string, CopyRole> = { error: "error", message: "text", title: "title", heading: "heading", label: "label", description: "text", hint: "text", help: "text", placeholder: "placeholder" };

function tagName(node: ts.JsxOpeningLikeElement): string {
  return node.tagName.getText();
}

function attribute(node: ts.JsxOpeningLikeElement, name: string): string | undefined {
  for (const property of node.attributes.properties) {
    if (!ts.isJsxAttribute(property) || property.name.getText() !== name || !property.initializer) continue;
    if (ts.isStringLiteral(property.initializer)) return property.initializer.text;
    if (ts.isJsxExpression(property.initializer) && property.initializer.expression) return property.initializer.expression.getText();
  }
  return undefined;
}

function roleOf(opening: ts.JsxOpeningLikeElement, inherited: CopyRole): CopyRole {
  const tag = tagName(opening).toLowerCase();
  const className = `${attribute(opening, "class") ?? ""} ${attribute(opening, "className") ?? ""} ${attribute(opening, "id") ?? ""}`;
  if (attribute(opening, "role") === "alert" || /\berror\b|\balert\b/i.test(className)) return "error";
  if (tag === "title") return "title";
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "button") return "button";
  if (tag === "a") return "link";
  if (["label", "legend", "th", "caption", "summary"].includes(tag)) return "label";
  if (tag === "option") return "option";
  return inherited === "error" ? "error" : INLINE.has(tag) ? inherited : "text";
}

const hasWords = (text: string) => /\p{L}{2,}/u.test(text.replace(/\{[^}]*\}/g, ""));
const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

export function extractCopy(path: string, source: string): CopyString[] {
  if (path.endsWith(".swift")) return extractSwiftCopy(path, source);
  const kind = /\.[jt]sx$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const found: CopyString[] = [];
  const lineOf = (node: ts.Node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const push = (text: string, role: CopyRole, node: ts.Node) => {
    const clean = tidy(text);
    if (clean && hasWords(clean)) found.push({ text: clean, role, line: lineOf(node) });
  };

  // One element's own text: its text and expressions, plus the text of any
  // inline children. Block children are visited separately.
  const visitElement = (element: ts.JsxElement | ts.JsxSelfClosingElement, inherited: CopyRole) => {
    const opening = ts.isJsxElement(element) ? element.openingElement : element;
    const role = roleOf(opening, inherited);
    const component = /^[A-Z]/.test(tagName(opening));
    for (const property of opening.attributes.properties) {
      if (!ts.isJsxAttribute(property) || !property.initializer || !ts.isStringLiteral(property.initializer)) continue;
      const name = property.name.getText();
      const attributeRole = component ? COMPONENT_PROPS[name] : ATTRIBUTES[name];
      if (attributeRole) push(property.initializer.text, attributeRole, property);
    }
    if (tagName(opening).toLowerCase() === "input" && /^(submit|button)$/.test(attribute(opening, "type") ?? "")) {
      const value = attribute(opening, "value");
      if (value) push(value, "button", opening);
    }
    if (!ts.isJsxElement(element)) return;

    let text = "";
    let first: ts.Node | undefined;
    const flush = () => {
      if (first) push(text, role, first);
      text = "";
      first = undefined;
    };
    const collect = (children: ts.NodeArray<ts.JsxChild>) => {
      for (const child of children) {
        if (ts.isJsxText(child)) {
          if (child.text.trim()) first ??= child;
          text += child.text;
        } else if (ts.isJsxExpression(child)) {
          const expression = child.expression;
          if (!expression) continue;
          if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
            first ??= child;
            text += expression.text;
          } else if (containsJsx(expression)) {
            flush();
            visitExpression(expression, role);
          } else {
            first ??= child;
            text += `{${expression.getText(file)}}`;
          }
        } else if ((ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) && INLINE.has(tagName(ts.isJsxElement(child) ? child.openingElement : child).toLowerCase())) {
          if (ts.isJsxElement(child)) collect(child.children);
          else text += " ";
        } else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
          flush();
          if (ts.isJsxFragment(child)) visitFragment(child, role);
          else visitElement(child, role);
        }
      }
    };
    collect(element.children);
    flush();
  };

  const visitFragment = (fragment: ts.JsxFragment, role: CopyRole) => {
    for (const child of fragment.children) {
      if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) visitElement(child, role);
      else if (ts.isJsxFragment(child)) visitFragment(child, role);
      else if (ts.isJsxText(child)) push(child.text, role, child);
      else if (ts.isJsxExpression(child) && child.expression) visitExpression(child.expression, role);
    }
  };

  // JSX inside expressions, such as items.map(i => <li>...</li>) or a ? <p/> : null.
  const visitExpression = (node: ts.Node, role: CopyRole) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) return visitElement(node, role);
    if (ts.isJsxFragment(node)) return visitFragment(node, role);
    ts.forEachChild(node, (child) => visitExpression(child, role));
  };

  const visitCode = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) return visitElement(node, "text");
    if (ts.isJsxFragment(node)) return visitFragment(node, "text");
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node)) return;
    if (ts.isCallExpression(node) && SKIP_CALLS.test(node.expression.getText(file))) return;
    if (ts.isNewExpression(node) && /Error$/.test(node.expression.getText(file))) return;
    // Strings under keys that name a message, such as { error: "..." }.
    if (ts.isPropertyAssignment(node) && (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))) {
      const role = MESSAGE_KEYS[node.name.getText(file).replace(/['"]/g, "")];
      if (role) return push(node.initializer.text, role, node.initializer);
    }
    // Any other string that reads as a sentence, such as a map of form messages.
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && SENTENCE.test(node.text) && !NOT_COPY.test(node.text) && node.text.length <= 300) {
      return push(node.text, ERRORISH.test(node.text) ? "error" : "text", node);
    }
    ts.forEachChild(node, visitCode);
  };

  visitCode(file);
  return found;
}

function containsJsx(node: ts.Node): boolean {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return true;
  return ts.forEachChild(node, containsJsx) ?? false;
}
