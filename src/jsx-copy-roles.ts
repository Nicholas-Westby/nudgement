import ts from "typescript5";
import type { CopyRole } from "./copy-extract";

// Tags whose text runs on into the surrounding sentence.
export const INLINE = new Set([
  "strong",
  "em",
  "b",
  "i",
  "span",
  "small",
  "code",
  "time",
  "abbr",
  "mark",
  "sub",
  "sup",
  "br",
  "kbd",
  "q",
  "s",
  "u",
]);

export const ATTRIBUTES: Record<string, CopyRole> = {
  title: "text",
  placeholder: "placeholder",
  "aria-label": "label",
  alt: "alt",
  label: "label",
};

// Props that carry text on components such as <Field hint="..."> or <Layout title="...">.
export const COMPONENT_PROPS: Record<string, CopyRole> = {
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

export const SENTENCE = /^\p{Lu}[^\n]*\s\S/u;

export const NOT_COPY = /^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH|PRAGMA|BEGIN)\b|^\w+:\/\/|^[./]/;

export const ERRORISH =
  /\b(invalid|too (long|short|many|few)|can't|cannot|must|required|not allowed|out of range|unknown|already|no longer|try again|failed)\b/i;

export const SKIP_CALLS = /^(console|logger|log|debug)\.|^(assert|expect|describe|it|test|require|import)$/;

export const MESSAGE_KEYS: Record<string, CopyRole> = {
  error: "error",
  message: "text",
  title: "title",
  heading: "heading",
  label: "label",
  description: "text",
  hint: "text",
  help: "text",
  placeholder: "placeholder",
};

export function tagName(node: ts.JsxOpeningLikeElement): string {
  return node.tagName.getText();
}

export function attribute(node: ts.JsxOpeningLikeElement, name: string): string | undefined {
  for (const property of node.attributes.properties) {
    if (!ts.isJsxAttribute(property) || property.name.getText() !== name || !property.initializer) continue;
    if (ts.isStringLiteral(property.initializer)) return property.initializer.text;
    if (ts.isJsxExpression(property.initializer) && property.initializer.expression)
      return property.initializer.expression.getText();
  }
  return undefined;
}

export function roleOf(opening: ts.JsxOpeningLikeElement, inherited: CopyRole): CopyRole {
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

export const hasWords = (text: string) => /\p{L}{2,}/u.test(text.replace(/\{[^}]*\}/g, ""));

export const tidy = (text: string) => text.replace(/\s+/g, " ").trim();
