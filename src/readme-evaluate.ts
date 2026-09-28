/**
 * Judges a README: does it sound human, is it succinct, is it structured well,
 * and does it say what the project is and how to use it. Exact checks (links,
 * scripts, headings) run in code; Jev answers one request about the whole
 * document and one per section, in parallel. Thresholds are in
 * README_THRESHOLDS so they can be tuned from the benchmark and the logs.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { listFolder, pathExists, pathsAt, readFileAt } from "./git";
import { choice, score, type Answers } from "./jev";
import { fmt, jevSource, reader, startRun, touches, type JevStats } from "./run";
import { analyzeMarkdown, readmeLint, type MdFacts, type MdSection } from "./markdown";
import { sortIssues, type Issue } from "./message";
import { shrinkOf } from "./code-questions";
import { readmeQuestions, readmeState, requiredQuestions, requiredState, sectionQuestions, sectionState, type ProjectContext } from "./readme-questions";

// Benchmarked 2026-09-26 on 30 labelled READMEs, three runs each. Jev moved
// by about 0.02 between runs. AI-voiced READMEs read at most 0.38 on
// sounds_human and human ones at least 0.50.
export const README_THRESHOLDS = {
  humanError: 0.44,
  humanWarn: 0.7,
  fillerError: 0.5,
  fillerWarn: 0.2,
  marketingError: 0.7,
  marketingWarn: 0.4,
  whatItIsError: 0.3,
  whatItIsWarn: 0.6,
  usageWarn: 0.4,
  shrinkError: 0.5,
  shrinkWarn: 0.3,
  // Warn and fail cuts per pattern. Jev reads structure problems low: good
  // READMEs stayed under 0.18 on over_structured, and under 0.36 on padding.
  patterns: {
    padding: [0.37, 0.6],
    over_structured: [0.22, 0.3],
    boilerplate: [0.7, 2],
    redundancy: [0.7, 2],
    disorganized: [0.7, 2],
  } as Record<string, [number, number]>,
  patternWarn: 0.7,
  terseError: 0.7,
  sectionHuman: 0.5,
  sectionFiller: 0.6,
  sectionShrink: 0.6,
  sectionEarns: 0.3,
  sectionMatches: 0.3,
  requirementError: 0.4,
  requirementWarn: 0.7,
};

const T = README_THRESHOLDS;

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
  /** Lines a commit added. When set, only the sections holding them are judged, and not the document as a whole, so an edit is not blamed for the rest of the file. */
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
    requirements.length ? track(`required:${input.path}`, requiredState(md, requirements), requiredQuestions(requirements)) : Promise.resolve(undefined),
    ...judged.map((section) => track(`section:${input.path}:${section.startLine}`, sectionState(md, section, project), sectionQuestions())),
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
    input.repo ? readFileAt(input.repo, path, ref) : existsSync(join(input.folder ?? ".", basename(path))) ? readFileSync(join(input.folder ?? ".", basename(path)), "utf8") : undefined;
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

const PATTERNS: Record<string, string> = {
  padding: "Spends words a reader does not need. Cut to what a newcomer needs.",
  over_structured: "More headings, lists, badges, or emoji than the content needs.",
  boilerplate: "Has generic sections with nothing specific to this project.",
  redundancy: "Says the same thing in more than one place.",
  disorganized: "Hard to find things in. Put what it is and how to use it first.",
};

function judgeReadme(answers: Answers, readings: Record<string, unknown>): Issue[] {
  const issues: Issue[] = [];
  const get = reader(answers, readings);
  const issue = (severity: Issue["severity"], part: string, message: string, key: string, value: number) =>
    issues.push({ severity, part, message, source: jevSource(key, value) });

  const human = get("sounds_human");
  if (human < T.humanError) issue("error", "voice", "Reads as AI-written. Say plainly what the project is and how to use it.", "sounds_human", human);
  else if (human < T.humanWarn) issue("warn", "voice", "Reads a little AI-written. Cut filler and be more direct.", "sounds_human", human);
  const filler = get("ai_filler");
  if (filler >= T.fillerError) issue("error", "voice", "Uses wording typical of AI text (robust, seamless, powerful, leverage...).", "ai_filler", filler);
  else if (filler >= T.fillerWarn) issue("warn", "voice", "Has some AI-style wording. Check for filler.", "ai_filler", filler);
  const marketing = get("marketing");
  if (marketing >= T.marketingError) issue("error", "voice", "Sells instead of informing. Drop the hype and state facts.", "marketing", marketing);
  else if (marketing >= T.marketingWarn) issue("warn", "voice", "Leans promotional in places.", "marketing", marketing);

  const what = get("says_what_it_is");
  if (what < T.whatItIsError) issue("error", "content", "Never plainly says what the project is. Open with one sentence that does.", "says_what_it_is", what);
  else if (what < T.whatItIsWarn) issue("warn", "content", "Takes too long to say what the project is.", "says_what_it_is", what);
  const usage = get("shows_usage");
  if (usage < T.usageWarn) issue("warn", "content", "Does not show how to install, run, or use it.", "shows_usage", usage);
  const terse = get("too_terse");
  if (terse >= T.terseError) issue("error", "content", "Too thin to help a newcomer.", "too_terse", terse);

  const rewrite = choice(answers, "rewrite_length");
  const shrink = shrinkOf(rewrite);
  readings.shrink = shrink;
  readings.rewrite_length = { choice: rewrite.choice, probabilities: rewrite.probabilities };
  if (shrink >= T.shrinkError) issues.push({ severity: "error", part: "length", message: "Bloated. The same content fits in far fewer words.", source: jevSource("shrink", shrink) });
  else if (shrink >= T.shrinkWarn) issues.push({ severity: "warn", part: "length", message: "Could be noticeably shorter.", source: jevSource("shrink", shrink) });

  for (const [key, message] of Object.entries(PATTERNS)) {
    const value = get(key);
    const [warn, error] = T.patterns[key] ?? [T.patternWarn, 2];
    if (value >= error) issue("error", key.replace(/_/g, " "), message, key, value);
    else if (value >= warn) issue("warn", key.replace(/_/g, " "), message, key, value);
  }

  const overall = score(answers, "overall");
  readings.overall = overall.score;
  const biggest = choice(answers, "biggest_problem");
  readings.biggest_problem = { choice: biggest.choice, confidence: biggest.confidence, probabilities: biggest.probabilities };
  if (biggest.choice !== "nothing") {
    issues.push({ severity: "info", part: "readme", message: `Biggest problem: ${biggest.choice.replace(/_/g, " ")}.`, source: `jev:biggest_problem=${biggest.choice}@${fmt(biggest.confidence)}` });
  }
  return issues;
}

function judgeRequirements(answers: Answers, requirements: string[], readings: Record<string, unknown>, asWarnings = false): Issue[] {
  const get = reader(answers, readings);
  return requirements.flatMap((requirement, index): Issue[] => {
    const key = `covers_${index + 1}`;
    const value = get(key);
    const source = jevSource(key, value);
    if (value < T.requirementError) return [{ severity: asWarnings ? "warn" : "error", part: "required", message: `Missing: ${requirement}`, source }];
    if (value < T.requirementWarn) return [{ severity: "warn", part: "required", message: `Only partly covers: ${requirement}`, source }];
    return [];
  });
}

function judgeSection(section: MdSection, answers: Answers | undefined): SectionResult {
  const result: SectionResult = { heading: section.heading, startLine: section.startLine, endLine: section.endLine, words: section.words, issues: [], readings: {} };
  if (!answers) return result;
  const part = `${section.heading} (line ${section.startLine})`;
  const readings = result.readings;
  const get = reader(answers, readings);
  const issue = (message: string, source: string) => result.issues.push({ severity: "warn", part, message, source });

  const human = get("sounds_human");
  const filler = get("filler");
  const earns = get("earns_its_place");
  const matches = get("matches_heading");
  const structured = get("over_structured");
  const rewrite = choice(answers, "rewrite_length");
  const shrink = shrinkOf(rewrite);
  const action = choice(answers, "action");
  Object.assign(readings, { shrink, action: action.choice, action_probabilities: action.probabilities });

  if (human < T.sectionHuman) issue("Reads as AI-written.", jevSource("sounds_human", human));
  else if (filler >= T.sectionFiller) issue("Uses filler or sales language.", jevSource("filler", filler));
  if (earns < T.sectionEarns) issue("A reader would not miss this section. Consider deleting it.", jevSource("earns_its_place", earns));
  if (matches < T.sectionMatches) issue("Does not deliver what its heading promises.", jevSource("matches_heading", matches));
  if (shrink >= T.sectionShrink) issue("Could say the same in far fewer words.", jevSource("shrink", shrink));
  if (structured >= T.patternWarn) issue("More sub-headings, bullets, or tables than it needs.", jevSource("over_structured", structured));
  return result;
}

function readmeScore(issues: Issue[], readings: Record<string, unknown>, sections: SectionResult[]): number {
  const human = typeof readings.sounds_human === "number" ? readings.sounds_human : 0.5;
  const overall = typeof readings.overall === "number" ? readings.overall / 3 : 0.5;
  const shrink = typeof readings.shrink === "number" ? readings.shrink : 0.5;
  const lintErrors = issues.filter((issue) => issue.severity === "error" && issue.source.startsWith("lint:")).length;
  const flaggedShare = sections.length ? sections.filter((section) => section.issues.length).length / sections.length : 0;
  const raw = 0.3 * human + 0.35 * overall + 0.2 * (1 - shrink) + 0.15 * (1 - flaggedShare) - 0.1 * lintErrors;
  return Math.max(0, Math.min(100, Math.round(raw * 100)));
}

/** The README at the top of a repo or folder, whatever its capitalization. */
export function findReadme(names: string[]): string | undefined {
  return names.find((name) => /^readme(\.(md|markdown|mdx|txt|rst))?$/i.test(name));
}
