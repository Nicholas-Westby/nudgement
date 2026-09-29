import type { CopyResult } from "./copy-evaluate";
import { judgeDecisions, judgeQuotedCopy, judgeSection, judgeWhole } from "./design-rules";
import { analyzeMarkdown } from "./markdown";
import { type Issue, sortIssues } from "./message";
import { fitText } from "./plan-parse";
import { DESIGN_QUESTIONS, SECTION_QUESTIONS } from "./plan-questions";
import type { SectionResult } from "./readme-evaluate";
import { type JevStats, startRun, touches } from "./run";
import { condenseDoc, designLint, docSections, isBackground, judgedText, type Requirement } from "./spec-parse";

// Calibrated on bench/designs.json: concrete sections stayed above 0.33,
// and resolved decisions stayed below 0.56 on open_decision.
export const DESIGN_THRESHOLDS = {
  humanError: 0.3,
  humanWarn: 0.5,
  fillerWarn: 0.5,
  intentWarn: 0.4,
  scopeWarn: 0.7,
  concreteWarn: 0.3,
  openWarn: 0.64,
  twoBuildsWarn: 0.85,
  // Missing-reason readings did not separate the labelled cases reliably; report notes only.
  needsReasonNote: 0.55,
  untestableWarn: 0.5,
};

export const T = DESIGN_THRESHOLDS;

// Leave room for questions when clipping whole documents and individual sections.
const WHOLE_BUDGET = 22_000;

const SECTION_BUDGET = 16_000;

const MIN_SECTION_WORDS = 20;

const MAX_SECTIONS = 40;

export const MAX_COPY = 60;

export const MAX_DECISIONS = 80;

export const DECISION_CONTEXT = 6_000;

// A spec for a Mac app is judged by Apple's rules for its copy, such as title-style buttons.
export const MAC = /\b(SwiftUI|AppKit|macOS|NSView|NSTextView|NSWindow)\b/;

const SCOPE_HEADING =
  /out of scope|not in (v\d|scope|this)|non-?goals|decided against|scope|what (it|this) (does|will) not/i;

export interface DocInput {
  /** Relative to the repo root when there is a repo. */
  path: string;
  text: string;
  repo?: string;
  ref?: string;
}

export interface DecisionResult extends Requirement {
  issues: Issue[];
  readings: Record<string, number>;
}

export interface DesignEvaluation {
  kind: "design";
  runId: string;
  version: string;
  repo?: string;
  ref?: string;
  path: string;
  verdict: "pass" | "fail";
  words: number;
  issues: Issue[];
  sections: SectionResult[];
  decisions: DecisionResult[];
  /** Strings the spec quotes that will appear in the app, judged by the copy check. */
  copy: CopyResult[];
  readings: Record<string, unknown>;
  jev: JevStats;
}

const wordsIn = (text: string) => text.replace(/^#+\s.*$/m, "").match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0;

export async function evaluateDesign(
  input: DocInput,
  options: { tag?: string; runId?: string; touched?: Set<number> } = {},
): Promise<DesignEvaluation> {
  const { runId, version, stats, issues, track, finish } = startRun(options.runId);
  const md = analyzeMarkdown(input.text);
  issues.push(...designLint(md));

  const all = docSections(md);
  // An edit to part of a spec is judged on the sections it touched, not the rest.
  const touched = options.touched;
  const edited = (section: { startLine: number; endLine: number }) => !touched || touches(touched, section);
  const inScope = (line: number) =>
    !touched ||
    all.some(
      (section) => section.level >= 2 && edited(section) && line >= section.startLine && line <= section.endLine,
    );
  const judged = all
    .filter((section) => section.level >= 2 && edited(section))
    .map((section) => ({ ...section, judged: judgedText(section) }))
    .filter((section) => section.judged && wordsIn(section.judged) >= MIN_SECTION_WORDS)
    .slice(0, MAX_SECTIONS);
  const outline = md.headings.map((heading) => `${"#".repeat(heading.level)} ${heading.text}`).slice(0, 120);
  const copyResults = judgeQuotedCopy(md, input.path, track, inScope);
  const decisionResults = judgeDecisions(md, input.path, track, inScope);
  const [whole, ...answers] = await Promise.all([
    touched
      ? Promise.resolve(undefined)
      : track(`design:${input.path}`, { spec: condenseDoc(md, WHOLE_BUDGET) }, DESIGN_QUESTIONS),
    ...judged.map((section) =>
      track(
        `design-section:${input.path}:${section.startLine}`,
        {
          spec_title: md.title ?? input.path,
          spec_outline: outline,
          section: { heading: section.path.join(" > "), text: fitText(section.judged!, SECTION_BUDGET) },
        },
        // Reasons and scope are not meant to be built from, so only an open decision counts there.
        isBackground(section) ? { open_decision: SECTION_QUESTIONS.open_decision } : SECTION_QUESTIONS,
      ),
    ),
  ]);

  const readings: Record<string, unknown> = {};
  if (whole)
    issues.push(
      ...judgeWhole(
        whole,
        readings,
        all.some((section) => SCOPE_HEADING.test(section.heading)),
      ),
    );
  const sections = judged.map((section, index): SectionResult => {
    const result: SectionResult = {
      heading: section.path.join(" > "),
      startLine: section.startLine,
      endLine: section.endLine,
      words: section.words,
      issues: [],
      readings: {},
    };
    if (answers[index])
      result.issues = judgeSection(answers[index]!, result.readings, `${section.heading} (line ${section.startLine})`);
    return result;
  });

  const [decisions, copy] = await Promise.all([decisionResults, copyResults]);

  const evaluation: DesignEvaluation = {
    kind: "design",
    runId,
    version,
    repo: input.repo,
    ref: input.ref,
    path: input.path,
    verdict: [...issues, ...sections.flatMap((s) => s.issues), ...copy.flatMap((c) => c.issues)].some(
      (issue) => issue.severity === "error",
    )
      ? "fail"
      : "pass",
    words: md.facts.words,
    issues: sortIssues(issues),
    sections,
    decisions,
    copy,
    readings,
    jev: stats,
  };
  return finish(evaluation, { tag: options.tag });
}
