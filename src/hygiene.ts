import { isBloatCandidate } from "./code";
import { commitMessages, filesAt, git, grep, matchesPath, nestedRepos, sizes, where } from "./hygiene-files";
import { logRun, newRunId, nudgementVersion } from "./log";
import { type Issue, parseMessage, type Severity, sortIssues } from "./message";
import { SECRET_PREFIXES, SECRETS, secretKind } from "./secrets";

export interface HygieneOptions {
  /** "dir/" matches anything under dir; otherwise a glob on the name, or on the path when it has a slash. */
  forbiddenPaths?: string[];
  forbiddenWords?: string[];
  forbidTrailers?: boolean;
  maxFileKb?: number;
  /** Paths left out of every check, such as test fixtures that hold fake secrets on purpose. */
  ignorePaths?: string[];
}

export interface HygieneResult {
  issues: Issue[];
  files: number;
}

const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs|e2e|fixtures?|mocks?)\/|\.(test|spec)\.\w+$/;

const ALWAYS_FORBIDDEN = [
  "node_modules/",
  ".DS_Store",
  ".env",
  ".env.local",
  ".env.*.local",
  ".dev.vars",
  ".wrangler/",
  "coverage/",
  "*.log",
  "*.sqlite",
  "*.sqlite3",
];

export function checkHygiene(repo: string, ref: string, options: HygieneOptions): HygieneResult {
  const issues: Issue[] = [];
  const add = (severity: Severity, part: string, message: string, rule: string) =>
    issues.push({ severity, part, message, source: `hygiene:${rule}` });
  const ignored = (path: string) => (options.ignorePaths ?? []).some((pattern) => matchesPath(path, pattern));
  const files = filesAt(repo, ref).filter((path) => !ignored(path));
  const grepAt = (patterns: string[], flags: string[]) =>
    grep(repo, ref, patterns, flags).filter((hit) => !ignored(hit.path));
  let messages: { sha: string; message: string }[] | undefined;
  const history = () => (messages ??= commitMessages(repo, ref));

  const patterns = [...ALWAYS_FORBIDDEN, ...(options.forbiddenPaths ?? [])];
  const forbidden = files.filter(
    (path) => !/\.(example|sample|template)$/.test(path) && patterns.some((pattern) => matchesPath(path, pattern)),
  );
  if (forbidden.length) {
    const shown = forbidden.slice(0, 8).join(", ") + (forbidden.length > 8 ? ` and ${forbidden.length - 8} more` : "");
    add(
      "error",
      "forbidden path",
      `These must not be committed: ${shown}. Remove them and add them to .gitignore.`,
      "forbidden-path",
    );
  }
  const nested = nestedRepos(repo, ref, files);
  if (nested.length)
    add(
      "error",
      "nested repo",
      `${nested.join(", ")} is a git repository of its own, such as a worktree; it would be committed as a bare link. Add it to .gitignore.`,
      "nested-repo",
    );

  const words = options.forbiddenWords ?? [];
  if (words.length) {
    const hits = grepAt(words, ["-i", "-w", "-F"]);
    const patterns = new Map(
      words.map((word) => [word, new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")]),
    );
    for (const word of words) {
      const found = hits.filter((hit) => patterns.get(word)?.test(hit.text));
      const named = files.filter((path) => path.toLowerCase().includes(word.toLowerCase()));
      if (found.length) add("error", "forbidden word", `"${word}" appears in ${where(found)}.`, "forbidden-word");
      if (named.length)
        add(
          "error",
          "forbidden word",
          `"${word}" is in the file name ${named.slice(0, 5).join(", ")}.`,
          "forbidden-word",
        );
    }
    // Branch and tag names are published with the repo too.
    const refs = git(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/tags"])
      .split("\n")
      .filter(Boolean);
    for (const word of words) {
      const named = refs.filter((name) => name.toLowerCase().includes(word.toLowerCase()));
      if (named.length)
        add("error", "forbidden word", `"${word}" is in the branch or tag name ${named.join(", ")}.`, "forbidden-word");
    }
    for (const word of words) {
      const commits = history().filter((commit) => patterns.get(word)?.test(commit.message));
      if (commits.length)
        add(
          "error",
          "forbidden word",
          `"${word}" appears in the message of commit ${commits
            .map((commit) => commit.sha)
            .slice(0, 5)
            .join(", ")}.`,
          "forbidden-word",
        );
    }
  }

  if (options.forbidTrailers) {
    const withTrailers = history().filter((commit) => parseMessage(commit.message).trailers.length);
    if (withTrailers.length) {
      add(
        "error",
        "trailers",
        `${withTrailers.length} commit(s) end with trailer lines, which this repo does not use: ${withTrailers
          .map((commit) => commit.sha)
          .slice(0, 8)
          .join(", ")}.`,
        "trailers",
      );
    }
  }

  // Use fixed prefixes for portable git grep, then validate in JavaScript.
  // Findings report locations without echoing the secret.
  const secretHits = grepAt(SECRET_PREFIXES, ["-F"]);
  for (const [name] of SECRETS) {
    const found = secretHits.filter((hit) => secretKind(hit.text) === name);
    if (found.length)
      add(
        "error",
        "secret",
        `Something that looks like ${name} is in ${where(found)}. Remove it and rotate it.`,
        "secret",
      );
  }

  const names = new Set(files.map((path) => path.toLowerCase()));
  if (![...names].some((path) => /^readme(\.\w+)?$/.test(path)))
    add("error", "readme", "There is no README at the top of the repo.", "no-readme");
  if (!names.has(".gitignore")) add("warn", "gitignore", "There is no .gitignore.", "no-gitignore");
  if (
    names.has("package.json") &&
    !["package-lock.json", "bun.lock", "bun.lockb", "pnpm-lock.yaml", "yarn.lock"].some((lock) => names.has(lock))
  ) {
    add("warn", "lockfile", "package.json has no lockfile beside it, so installs are not reproducible.", "no-lockfile");
  }

  const maxBytes = (options.maxFileKb ?? 500) * 1024;
  const large = sizes(repo, ref, files).filter(([, size]) => size > maxBytes);
  if (large.length) {
    add(
      "warn",
      "large file",
      `Large files: ${large
        .slice(0, 5)
        .map(([path, size]) => `${path} (${Math.round(size / 1024)} KB)`)
        .join(", ")}.`,
      "large-file",
    );
  }

  // Ignore test samples when checking source for unfinished work.
  const source = (hit: { path: string }) => isBloatCandidate(hit.path) && !TEST_PATH.test(hit.path);
  const todos = grepAt(["TODO", "FIXME", "XXX"], ["-w", "-F"]).filter(source);
  if (todos.length) add("info", "todo", `${todos.length} TODO or FIXME note(s) in source: ${where(todos, 3)}.`, "todo");

  return { issues: sortIssues(issues), files: files.length };
}

export interface HygieneEvaluation {
  kind: "hygiene";
  runId: string;
  version: string;
  repo: string;
  ref: string;
  verdict: "pass" | "fail";
  files: number;
  issues: Issue[];
}

export function evaluateHygiene(repo: string, ref: string, options: HygieneOptions, tag?: string): HygieneEvaluation {
  const { issues, files } = checkHygiene(repo, ref, options);
  const evaluation: HygieneEvaluation = {
    kind: "hygiene",
    runId: newRunId(),
    version: nudgementVersion(),
    repo,
    ref,
    verdict: issues.some((issue) => issue.severity === "error") ? "fail" : "pass",
    files,
    issues,
  };
  logRun({ ...evaluation, tag });
  return evaluation;
}

export { matchesPath } from "./hygiene-files";
export { secretKind } from "./secrets";
