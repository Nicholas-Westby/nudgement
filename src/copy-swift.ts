import type { CopyString } from "./copy-extract";
import { CODE_LIKE, FORMAT, IDENTIFIER, roleOf } from "./swift-copy-roles";
import { SwiftSource } from "./swift-source";

export function extractSwiftCopy(path: string, source: string): CopyString[] {
  if (/(^|\/)\w*Tests?\/|Tests?\.swift$/.test(path)) return [];
  const swift = new SwiftSource(source);
  const found: CopyString[] = [];
  swift.tokens.forEach((token, index) => {
    if (token.kind !== "str") return;
    const role = roleOf(swift, index);
    if (!role) return;
    const clean = token.value!.replace(FORMAT, "{…}").replace(/\s+/g, " ").trim();
    if (
      !/\p{L}{2,}/u.test(clean.replace(/\{[^}]*\}/g, "")) ||
      /^\w+:\/\//.test(clean) ||
      IDENTIFIER.test(clean) ||
      CODE_LIKE.test(clean)
    )
      return;
    found.push({ text: clean, role, line: token.line });
  });
  return found;
}
