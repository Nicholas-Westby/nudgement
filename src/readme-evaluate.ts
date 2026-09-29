import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { listFolder, pathExists, pathsAt, readFileAt } from "./git";
import { analyzeMarkdown, type MdFacts, readmeLint } from "./markdown";
import { type Issue, sortIssues } from "./message";
import {
  type ProjectContext,
  readmeQuestions,
  readmeState,
  requiredQuestions,
  requiredState,
  sectionQuestions,
  sectionState,
} from "./readme-questions";
import { judgeReadme, judgeRequirements, judgeSection, readmeScore } from "./readme-rules";
import { type JevStats, startRun, touches } from "./run";

// Sections shorter than this are too small to judge on their own.
const MIN_SECTION_WORDS = 15;

const MAX_SECTIONS = 30;

export interface ReadmeInput {
  /** Relative to the repo root when there is a repo. */
  path: string;
  text: string;
  repo?: string;
  ref?: string;
  /** Without a repo, the folder the README sits in, for checking its links. */
  folder?: string;
  /** Overrides how linked files are checked, for READMEs judged away from their repo. */
  exists?: (path: string) => boolean;
}

export interface SectionResult {
  heading: string;
  startLine: number;
  endLine: number;
  words: number;
  issues: Issue[];
  readings: Record<string, unknown>;
}

export interface ReadmeEvaluation {
  kind: "readme";
  runId: string;
  version: string;
  repo?: string;
  ref?: string;
  path: string;
  verdict: "pass" | "fail";
  /** 0 to 100. Rough, for comparing drafts of the same README. */
  score: number;
  facts: MdFacts;
  issues: Issue[];
  sections: SectionResult[];
  readings: Record<string, unknown>;
  jev: JevStats;
}

export interface ReadmeOptions {
  tag?: string;
  runId?: string;
  /** Content the README must cover, such as "how to run it locally". */
  requirements?: string[];
  /** Report missing requirements as warnings: a commit may land before the README is finished. */
  requirementsAsWarnings?: boolean;
  /** Limit a commit review to sections containing added lines; skip whole-document judgments. */
  touched?: Set<number>;
}

export async function evaluateReadme(input: ReadmeInput, options: ReadmeOptions = {}): Promise<ReadmeEvaluation> {
  const { runId, version, stats, issues, track, finish } = startRun(options.runId);
  const md = analyzeMarkdown(input.text);
  const ref = input.ref ?? "worktree";
  const folder = dirname(input.path);

  // Links at a commit or in the index are looked up in one listing of it.
  let paths: Set<string> | undefined;
  const exists = input.exists
    ? input.exists
    : input.repo
      ? ref === "worktree"
        ? (path: string) => pathExists(input.repo!, path, ref)
        : (path: string) => (paths ??= pathsAt(input.repo!, ref)).has(path)
      : (path: string) => existsSync(join(input.folder ?? ".", path));
  const project = projectContext(input, ref, folder);
  issues.push(...readmeLint(md, { exists, scripts: project.scripts && new Set(project.scripts), path: input.path }));

  const touched = options.touched;
  const judged = md.sections
    .filter((section) => section.words >= MIN_SECTION_WORDS)
    .filter((section) => !touched || touches(touched, section))
    .slice(0, MAX_SECTIONS);
  const requirements = options.requirements ?? [];
  const [whole, required, ...sectionAnswers] = await Promise.all([
    touched ? Promise.resolve(undefined) : track(`readme:${input.path}`, readmeState(md, project), readmeQuestions()),
    requirements.length
      ? track(`required:${input.path}`, requiredState(md, requirements), requiredQuestions(requirements))
      : Promise.resolve(undefined),
    ...judged.map((section) =>
      track(`section:${input.path}:${section.startLine}`, sectionState(md, section, project), sectionQuestions()),
    ),
  ]);

  const readings: Record<string, unknown> = {};
  if (whole) issues.push(...judgeReadme(whole, readings));
  if (required) issues.push(...judgeRequirements(required, requirements, readings, options.requirementsAsWarnings));
  const sections = judged.map((section, index) => judgeSection(section, sectionAnswers[index]));

  const verdict = issues.some((issue) => issue.severity === "error") ? "fail" : "pass";
  const evaluation: ReadmeEvaluation = {
    kind: "readme",
    runId,
    version,
    repo: input.repo,
    ref: input.ref,
    path: input.path,
    verdict,
    score: readmeScore(issues, readings, sections),
    facts: md.facts,
    issues: sortIssues(issues),
    sections,
    readings,
    jev: stats,
  };
  return finish(evaluation, { tag: options.tag });
}

function projectContext(input: ReadmeInput, ref: string, folder: string): ProjectContext {
  const read = (path: string) =>
    input.repo
      ? readFileAt(input.repo, path, ref)
      : existsSync(join(input.folder ?? ".", basename(path)))
        ? readFileSync(join(input.folder ?? ".", basename(path)), "utf8")
        : undefined;
  let pkg: { name?: string; description?: string; scripts?: Record<string, string> } | undefined;
  try {
    const text = read(join(folder, "package.json"));
    pkg = text ? JSON.parse(text) : undefined;
  } catch {
    pkg = undefined;
  }
  const files = input.repo ? listFolder(input.repo, folder, ref) : [];
  return {
    name: pkg?.name ?? basename(input.repo ? (folder === "." ? input.repo : folder) : (input.folder ?? ".")),
    ...(pkg?.description ? { description: pkg.description } : {}),
    files: files.slice(0, 60),
    ...(pkg?.scripts ? { scripts: Object.keys(pkg.scripts) } : {}),
  };
}

/** The README at the top of a repo or folder, whatever its capitalization. */
export function findReadme(names: string[]): string | undefined {
  return names.find((name) => /^readme(\.(md|markdown|mdx|txt|rst))?$/i.test(name));
}
export { README_THRESHOLDS } from "./readme-rules";
