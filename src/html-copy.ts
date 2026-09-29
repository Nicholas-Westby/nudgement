import { type DefaultTreeAdapterTypes as Html, parse } from "parse5";
import type { CopyRole, CopyString } from "./copy-extract";
import { ATTRIBUTES, hasWords, INLINE, tidy } from "./jsx-copy-roles";

// Review the page's own prose, not scripts, decorative artwork or quoted code/findings.
const EXCLUDED = new Set(["script", "style", "template", "svg", "canvas", "pre", "blockquote"]);
const attr = (node: Html.Element, name: string) => node.attrs.find((item) => item.name === name)?.value;
const excluded = (node: Html.Element) => EXCLUDED.has(node.tagName) || attr(node, "aria-hidden") === "true";

// Error containers pass their role to nested paragraphs; ordinary blocks start a new text role.
function roleOf(node: Html.Element, inherited: CopyRole): CopyRole {
  if (attr(node, "role") === "alert") return "error";
  if (node.tagName === "title") return "title";
  if (/^h[1-6]$/.test(node.tagName)) return "heading";
  // Pressed buttons choose or toggle a state; their labels need not begin with an action verb.
  if (node.tagName === "button") return attr(node, "aria-pressed") === undefined ? "button" : "option";
  if (node.tagName === "a") return "link";
  if (["label", "legend", "th", "caption", "summary"].includes(node.tagName)) return "label";
  if (node.tagName === "option") return "option";
  return inherited === "error" ? "error" : INLINE.has(node.tagName) ? inherited : "text";
}

/** Parse HTML as HTML: void tags, entities and optional closing tags need browser-style recovery. */
export function extractHtmlCopy(source: string): CopyString[] {
  const document = parse(source, { sourceCodeLocationInfo: true });
  const found: CopyString[] = [];
  const push = (text: string, role: CopyRole, line: number) => {
    const clean = tidy(text);
    if (hasWords(clean)) found.push({ text: clean, role, line });
  };

  function visit(node: Html.ParentNode, inherited: CopyRole) {
    const element = "tagName" in node ? node : undefined;
    if (element && excluded(element)) return;
    const role = element ? roleOf(element, inherited) : inherited;
    for (const property of element?.attrs ?? []) {
      const attributeRole = ATTRIBUTES[property.name];
      if (attributeRole) {
        const line = element?.sourceCodeLocation?.attrs?.[property.name]?.startLine ?? 1;
        push(property.value, attributeRole, line);
      }
    }
    if (element?.tagName === "input" && /^(submit|button)$/.test(attr(element, "type") ?? ""))
      push(attr(element, "value") ?? "", "button", element.sourceCodeLocation?.startLine ?? 1);

    let text = "";
    let line = 0;
    const flush = () => {
      push(text, role, line || 1);
      text = "";
      line = 0;
    };
    // Join inline markup into its sentence, but flush at blocks so unrelated paragraphs never merge.
    function collect(children: Html.ChildNode[]) {
      for (const child of children) {
        if ("value" in child) {
          // Leading whitespace belongs to the previous tag's line, not the first word's line.
          if (!line && child.value.trim()) {
            const leading = child.value.match(/^\s*/)?.[0] ?? "";
            line = (child.sourceCodeLocation?.startLine ?? 1) + leading.split("\n").length - 1;
          }
          text += child.value;
        } else if ("tagName" in child && !excluded(child)) {
          if (child.tagName === "br") text += " ";
          else if (INLINE.has(child.tagName) || child.tagName === "a") {
            collect(child.childNodes);
            // Keep a paragraph intact, while also checking its link's destination wording.
            if (child.tagName === "a") visit(child, role);
          } else {
            flush();
            visit(child, role);
          }
        }
      }
    }
    collect(node.childNodes);
    flush();
  }
  visit(document, "text");
  return found;
}
