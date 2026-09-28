/**
 * Judges a design spec, the document the brainstorming step writes before a
 * plan: does it say why and what is out of scope, does it read as written by
 * a person, and is each section concrete enough that two engineers would
 * build the same thing. Code finds placeholders and open questions; Jev
 * answers one request about the whole spec and one per section.
 */

import { choice, type Answers } from "./jev";
import { analyzeMarkdown, type MdAnalysis } from "./markdown";
import { sortIssues, type Issue } from "./message";
import { fitText } from "./plan-parse";
import { DECISION_QUESTIONS, DESIGN_QUESTIONS, SECTION_QUESTIONS } from "./plan-questions";
import type { SectionResult } from "./readme-evaluate";
import { condenseDoc, decisionsOf, designLint, docSections, isBackground, judgedText, quotedCopy, type Requirement } from "./spec-parse";
import { judgeString, stringQuestions, type CopyResult, type Platform } from "./copy-evaluate";
import { jevSource, reader, startRun, touches, type JevStats, type Track } from "./run";

// Benchmarked 2026-09-27 on 8 specs (3 real, 5 degraded or handwritten) and
// their 147 sections. Real sections read at least 0.33 on concrete and at
// most 0.56 on open_decision; the vague and undecided ones went past both.
export const DESIGN_THRESHOLDS = {
  humanError: 0.3,
  humanWarn: 0.5,
  fillerWarn: 0.5,
  intentWarn: 0.4,
  scopeWarn: 0.7,
  concreteWarn: 0.3,
  openWarn: 0.64,
  twoBuildsWarn: 0.85,
  // Only a weak signal: on 123 decisions from the real batch spec and a copy
  // with 12 reasons cut, no cut separated them (AUC 0.72), so it is a note.
  needsReasonNote: 0.55,
  untestableWarn: 0.5,
};
const T = DESIGN_THRESHOLDS;

// About 6,000 tokens for the whole spec and 4,500 for one section, so every
// request stays under 8,000 with its questions.
const WHOLE_BUDGET = 22_000;
const SECTION_BUDGET = 16_000;
const MIN_SECTION_WORDS = 20;
const MAX_SECTIONS = 40;
const MAX_COPY = 60;
const MAX_DECISIONS = 80;
const DECISION_CONTEXT = 6_000;

// A spec for a Mac app is judged by Apple's rules for its copy, such as title-style buttons.
const MAC = /\b(SwiftUI|AppKit|macOS|NSView|NSTextView|NSWindow)\b/;
const SCOPE_HEADING = /out of scope|not in (v\d|scope|this)|non-?goals|decided against|scope|what (it|this) (does|will) not/i;

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

export async function evaluateDesign(input: DocInput, options: { tag?: string; runId?: string; touched?: Set<number> } = {}): Promise<DesignEvaluation> {
  const { runId, version, stats, issues, track, finish } = startRun(options.runId);
  const md = analyzeMarkdown(input.text);
  issues.push(...designLint(md));

  const all = docSections(md);
  // An edit to part of a spec is judged on the sections it touched, not the rest.
  const touched = options.touched;
  const edited = (section: { startLine: number; endLine: number }) => !touched || touches(touched, section);
  const inScope = (line: number) => !touched || all.some((section) => section.level >= 2 && edited(section) && line >= section.startLine && line <= section.endLine);
  const judged = all
    .filter((section) => section.level >= 2 && edited(section))
    .map((section) => ({ ...section, judged: judgedText(section) }))
    .filter((section) => section.judged && wordsIn(section.judged) >= MIN_SECTION_WORDS)
    .slice(0, MAX_SECTIONS);
  const outline = md.headings.map((heading) => `${"#".repeat(heading.level)} ${heading.text}`).slice(0, 120);
  const copyResults = judgeQuotedCopy(md, input.path, track, inScope);
  const decisionResults = judgeDecisions(md, input.path, track, inScope);
  const [whole, ...answers] = await Promise.all([
    touched ? Promise.resolve(undefined) : track(`design:${input.path}`, { spec: condenseDoc(md, WHOLE_BUDGET) }, DESIGN_QUESTIONS),
    ...judged.map((section) =>
      track(
        `design-section:${input.path}:${section.startLine}`,
        { spec_title: md.title ?? input.path, spec_outline: outline, section: { heading: section.path.join(" > "), text: fitText(section.judged!, SECTION_BUDGET) } },
        // Reasons and scope are not meant to be built from, so only an open decision counts there.
        isBackground(section) ? { open_decision: SECTION_QUESTIONS.open_decision } : SECTION_QUESTIONS
      )
    ),
  ]);

  const readings: Record<string, unknown> = {};
  if (whole) issues.push(...judgeWhole(whole, readings, all.some((section) => SCOPE_HEADING.test(section.heading))));
  const sections = judged.map((section, index): SectionResult => {
    const result: SectionResult = { heading: section.path.join(" > "), startLine: section.startLine, endLine: section.endLine, words: section.words, issues: [], readings: {} };
    if (answers[index]) result.issues = judgeSection(answers[index]!, result.readings, `${section.heading} (line ${section.startLine})`);
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
    verdict: [...issues, ...sections.flatMap((s) => s.issues), ...copy.flatMap((c) => c.issues)].some((issue) => issue.severity === "error") ? "fail" : "pass",
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

async function judgeDecisions(md: MdAnalysis, path: string, track: Track, inScope: (line: number) => boolean): Promise<DecisionResult[]> {
  const sections = docSections(md);
  return Promise.all(
    decisionsOf(md)
      .filter((decision) => inScope(decision.line))
      .slice(0, MAX_DECISIONS)
      .map(async (decision): Promise<DecisionResult> => {
        const around = sections.find((section) => section.startLine <= decision.line && decision.line <= section.endLine);
        const state = { spec_title: md.title ?? path, section: fitText(around ? (judgedText(around) ?? "") : "", DECISION_CONTEXT), decision: decision.text };
        const answers = await track(`design-decision:${path}:${decision.line}`, state, DECISION_QUESTIONS);
        const result: DecisionResult = { ...decision, issues: [], readings: {} };
        if (!answers) return result;
        const unanswered = (result.readings.needs_reason = choice(answers, "why").probabilities.none ?? 0);
        if (unanswered >= T.needsReasonNote) result.issues.push({ severity: "info", part: `line ${result.line}`, message: "May make a decision without saying why, or what it rules out.", source: jevSource("needs_reason", unanswered) });
        return result;
      })
  );
}

async function judgeQuotedCopy(md: MdAnalysis, path: string, track: Track, inScope: (line: number) => boolean): Promise<CopyResult[]> {
  const quoted = quotedCopy(md).filter((item) => inScope(item.line)).slice(0, MAX_COPY);
  const platform: Platform = MAC.test(md.lines.join("\n")) ? "mac" : "web";
  const proper = properNouns(md.lines.join("\n"));
  const context = { app: `The app that the spec "${md.title ?? path}" describes. Readers are its everyday users, not developers.`, page: path, other_text_on_the_page: quoted.slice(0, 40).map((item) => item.text) };
  return Promise.all(
    quoted.map(async (item) => {
      const answers = await track(`design-copy:${path}:${item.line}`, { ...context, role: item.role, text: item.text }, stringQuestions(item.role, item.text, platform));
      return judgeString(item, answers, proper, platform);
    })
  );
}

function judgeWhole(answers: Answers, readings: Record<string, unknown>, hasScopeHeading: boolean): Issue[] {
  const issues: Issue[] = [];
  const get = reader(answers, readings);
  const add = (severity: Issue["severity"], part: string, message: string, key: string, value: number) => issues.push({ severity, part, message, source: jevSource(key, value) });

  const human = get("sounds_human");
  if (human < T.humanError) add("error", "voice", "Reads as AI-written. Say plainly what will be built and why.", "sounds_human", human);
  else if (human < T.humanWarn) add("warn", "voice", "Reads a little AI-written. Cut filler and be more direct.", "sounds_human", human);
  const filler = get("ai_filler");
  if (filler >= T.fillerWarn) add("warn", "voice", "Uses wording typical of AI text (robust, seamless, comprehensive, leverage...).", "ai_filler", filler);
  const intent = get("states_intent");
  if (intent < T.intentWarn) add("warn", "intent", "Never says what problem this solves or what the people it is for want.", "states_intent", intent);
  const scope = get("states_out_of_scope");
  if (scope < T.scopeWarn && !hasScopeHeading) add("warn", "scope", "Never says what is out of scope.", "states_out_of_scope", scope);
  return issues;
}

function judgeSection(answers: Answers, readings: Record<string, unknown>, part: string): Issue[] {
  const issues: Issue[] = [];
  const get = reader(answers, readings);
  const add = (message: string, key: string, value: number) => issues.push({ severity: "warn", part, message, source: jevSource(key, value) });
  const open = get("open_decision");
  if (open >= T.openWarn) add("Leaves a decision open without saying so.", "open_decision", open);
  if (!answers.concrete) return issues;
  const concrete = get("concrete");
  if (concrete < T.concreteWarn) add("Vague: says what it wants, not what exactly happens.", "concrete", concrete);
  const untestable = get("untestable");
  if (untestable >= T.untestableWarn) add("States an outcome a tester could not check as pass or fail.", "untestable", untestable);
  const builds = choice(answers, "two_builds");
  const two = (readings.two_builds = (builds.probabilities.different_behaviour ?? 0) + (builds.probabilities.different_things ?? 0)) as number;
  if (two >= T.twoBuildsWarn) add("Two engineers could build different things from this.", "two_builds", two);
  return issues;
}

// Words written with a capital in the middle of a sentence are names in this
// spec, such as "Seed Swap" or "Tide Clock", and keep their capitals in its copy.
function properNouns(text: string): Set<string> {
  const names = [...text.matchAll(/(?<=[\p{Ll},;:)] )\p{Lu}[\p{L}\p{N}.'’-]*/gu)].map((match) => match[0].replace(/[.'’-]+$/, ""));
  // Acronyms the spec uses, such as UTC or EUR, are shown as they are.
  const acronyms = text.match(/\b\p{Lu}{2,5}\b/gu) ?? [];
  return new Set(["I", "OK", ...names, ...acronyms]);
}
