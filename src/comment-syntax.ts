export type Syntax = { line: string[]; block: [string, string][]; strings?: string[]; heredoc?: boolean };

const SLASH: Syntax = { line: ["//"], block: [["/*", "*/"]] };

const HASH: Syntax = { line: ["#"], block: [] };

// Strings that run over several lines, whose lines can look like comments.
const JS_STRINGS = ["`"];

const TRIPLE_QUOTES = ['"""'];

const MARKUP: Syntax = {
  line: ["//"],
  block: [
    ["/*", "*/"],
    ["<!--", "-->"],
  ],
};

const DASH: Syntax = { line: ["--"], block: [] };

const BY_EXTENSION: Record<string, [string, Syntax]> = {};

for (const ext of [
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "mts",
  "cts",
  "java",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "cs",
  "go",
  "rs",
  "swift",
  "kt",
  "kts",
  "scala",
  "php",
  "dart",
  "jsonc",
  "groovy",
  "zig",
])
  BY_EXTENSION[ext] = [ext, SLASH];

// JSX puts comments inside braces: {/* like this */}
const JSX: Syntax = {
  line: ["//"],
  block: [
    ["/*", "*/"],
    ["{/*", "*/}"],
  ],
};

for (const ext of ["tsx", "jsx"]) BY_EXTENSION[ext] = [ext, JSX];

for (const ext of ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"])
  BY_EXTENSION[ext] = [ext, { ...BY_EXTENSION[ext][1], strings: JS_STRINGS }];

for (const ext of ["swift", "kt", "kts", "scala", "dart", "groovy", "java"])
  BY_EXTENSION[ext] = [ext, { ...SLASH, strings: TRIPLE_QUOTES }];

for (const ext of ["css", "scss", "less"])
  BY_EXTENSION[ext] = [ext, { line: ext === "css" ? [] : ["//"], block: [["/*", "*/"]] }];

for (const ext of [
  "py",
  "sh",
  "bash",
  "zsh",
  "fish",
  "rb",
  "yml",
  "yaml",
  "toml",
  "r",
  "pl",
  "ps1",
  "tf",
  "nix",
  "ex",
  "exs",
  "cmake",
  "mk",
])
  BY_EXTENSION[ext] = [ext, HASH];

BY_EXTENSION.py = ["py", { ...HASH, strings: ['"""', "'''"] }];

for (const ext of ["sh", "bash", "zsh"]) BY_EXTENSION[ext] = [ext, { ...HASH, heredoc: true }];

for (const ext of ["html", "htm", "vue", "svelte", "astro", "xml", "svg", "mdx"]) BY_EXTENSION[ext] = [ext, MARKUP];

for (const ext of ["sql", "lua", "hs", "elm"]) BY_EXTENSION[ext] = [ext, DASH];

export function syntaxFor(path: string, text?: string): [string, Syntax] | undefined {
  const name = path.split("/").pop() ?? path;
  if (name === "Dockerfile" || name === "Makefile" || name.startsWith(".env") || name.endsWith(".gitignore"))
    return [name, HASH];
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return BY_EXTENSION[ext] ?? (ext ? undefined : fromShebang(text));
}

// Scripts such as ./bootstrap have no extension; their first line says what they are.
function fromShebang(text: string | undefined): [string, Syntax] | undefined {
  const shebang = text?.startsWith("#!") ? text.slice(0, text.indexOf("\n") >>> 0) : "";
  if (!shebang) return undefined;
  if (/python/.test(shebang)) return BY_EXTENSION.py;
  if (/\b(node|bun|deno|tsx|ts-node)\b/.test(shebang)) return BY_EXTENSION.js;
  if (/ruby/.test(shebang)) return ["rb", HASH];
  return ["sh", { ...HASH, heredoc: true }];
}

// Machine-read comments. Judging their prose would be noise.
export const DIRECTIVE =
  /^(#!|\/\/\/\s*<reference|\/\/\s*@ts-|\/\*\s*eslint|\/\/\s*eslint|\/\/\s*prettier-ignore|#\s*type:\s*ignore|#\s*noqa|#\s*pylint:|#\s*-\*-|\/\/\s*nolint|\/\/\s*#(region|endregion)|#\s*(region|endregion)|\/\/\s*go:|\/\/\s*swiftlint|\/\*\s*istanbul|\/\/\s*biome-ignore|\/\/\s*SPDX|#\s*SPDX|#\s*shellcheck|#\s*frozen_string_literal|\{?\s*\/\*\s*@__PURE__|(\/\/|\/\*)\s*([Ss]tryker (disable|restore)|[cv]8 ignore|@(vitest|jest)-environment|deno-lint-ignore|oxlint-disable)|#\s*rubocop:)/;
