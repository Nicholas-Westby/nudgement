import ts from "typescript5";
import { extractSwiftCopy } from "./copy-swift";
import {
  ATTRIBUTES,
  attribute,
  COMPONENT_PROPS,
  ERRORISH,
  hasWords,
  INLINE,
  MESSAGE_KEYS,
  NOT_COPY,
  roleOf,
  SENTENCE,
  SKIP_CALLS,
  tagName,
  tidy,
} from "./jsx-copy-roles";

export type CopyRole =
  | "title"
  | "heading"
  | "button"
  | "link"
  | "label"
  | "placeholder"
  | "alt"
  | "error"
  | "option"
  | "tooltip"
  | "text";

export interface CopyString {
  text: string;
  role: CopyRole;
  line: number;
}

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

  // Inline children share the sentence; block children need their own copy role.
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
        } else if (
          (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) &&
          INLINE.has(tagName(ts.isJsxElement(child) ? child.openingElement : child).toLowerCase())
        ) {
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

    if (
      ts.isPropertyAssignment(node) &&
      (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))
    ) {
      const role = MESSAGE_KEYS[node.name.getText(file).replace(/['"]/g, "")];
      if (role) return push(node.initializer.text, role, node.initializer);
    }
    // Form-message maps may contain sentences without a recognized property name.
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      SENTENCE.test(node.text) &&
      !NOT_COPY.test(node.text) &&
      node.text.length <= 300
    ) {
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
