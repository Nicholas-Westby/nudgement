import { parseArgs } from "node:util";
import { fail } from "./cli-files";

const SHORT: Record<string, string> = { m: "message", F: "message-file", h: "help" };

let parsed: ReturnType<typeof parse>;

try {
  parsed = parse();
} catch (error) {
  fail(`${error instanceof Error ? error.message : error}\nRun with --help for usage.`);
}

const options = parsed!.values;

export const positional = parsed!.positionals;

const key = (name: string) => SHORT[name.replace(/^-+/, "")] ?? name.replace(/^-+/, "");

export const flag = (name: string) => options[key(name) as keyof typeof options] === true;

// -m and --message are one option, so ask for each option once.
export const all = (...names: string[]) =>
  [...new Set(names.map(key))].flatMap((name) => {
    const found = options[name as keyof typeof options];
    return typeof found === "string" ? [found] : Array.isArray(found) ? found : [];
  });

export const value = (...names: string[]) => all(...names)[0];

// Unknown flags are an error, so a typo such as --check-file cannot silently skip a check.
function parse() {
  return parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      message: { type: "string", short: "m", multiple: true },
      "message-file": { type: "string", short: "F" },
      hash: { type: "string" },
      range: { type: "string" },
      staged: { type: "boolean" },
      amend: { type: "boolean" },
      "check-files": { type: "boolean" },
      file: { type: "string", multiple: true },
      readme: { type: "boolean" },
      context: { type: "string" },
      require: { type: "string", multiple: true },
      "require-file": { type: "string", multiple: true },
      "no-comments": { type: "boolean" },
      config: { type: "string" },
      "repo-check": { type: "boolean" },
      history: { type: "boolean" },
      tests: { type: "string", multiple: true },
      copy: { type: "string", multiple: true },
      design: { type: "string" },
      plan: { type: "string", multiple: true },
      json: { type: "boolean" },
      verbose: { type: "boolean" },
      tag: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
}
