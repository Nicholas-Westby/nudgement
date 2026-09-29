import { type CopyResult, judgeString, type Platform, stringQuestions } from "./copy-evaluate";
import { DECISION_CONTEXT, type DecisionResult, MAC, MAX_COPY, MAX_DECISIONS, T } from "./design-evaluate";
import { type Answers, choice } from "./jev";
import type { MdAnalysis } from "./markdown";
import type { Issue } from "./message";
import { fitText } from "./plan-parse";
import { DECISION_QUESTIONS } from "./plan-questions";
import { jevSource, reader, type Track } from "./run";
import { decisionsOf, docSections, judgedText, quotedCopy } from "./spec-parse";

export async function judgeDecisions(
  md: MdAnalysis,
  path: string,
  track: Track,
  inScope: (line: number) => boolean,
): Promise<DecisionResult[]> {
  const sections = docSections(md);
  return Promise.all(
    decisionsOf(md)
      .filter((decision) => inScope(decision.line))
      .slice(0, MAX_DECISIONS)
      .map(async (decision): Promise<DecisionResult> => {
        const around = sections.find(
          (section) => section.startLine <= decision.line && decision.line <= section.endLine,
        );
        const state = {
          spec_title: md.title ?? path,
          section: fitText(around ? (judgedText(around) ?? "") : "", DECISION_CONTEXT),
          decision: decision.text,
        };
        const answers = await track(`design-decision:${path}:${decision.line}`, state, DECISION_QUESTIONS);
        const result: DecisionResult = { ...decision, issues: [], readings: {} };
        if (!answers) return result;
        const unanswered = (result.readings.needs_reason = choice(answers, "why").probabilities.none ?? 0);
        if (unanswered >= T.needsReasonNote)
          result.issues.push({
            severity: "info",
            part: `line ${result.line}`,
            message: "May make a decision without saying why, or what it rules out.",
            source: jevSource("needs_reason", unanswered),
          });
        return result;
      }),
  );
}

export async function judgeQuotedCopy(
  md: MdAnalysis,
  path: string,
  track: Track,
  inScope: (line: number) => boolean,
): Promise<CopyResult[]> {
  const quoted = quotedCopy(md)
    .filter((item) => inScope(item.line))
    .slice(0, MAX_COPY);
  const platform: Platform = MAC.test(md.lines.join("\n")) ? "mac" : "web";
  const proper = properNouns(md.lines.join("\n"));
  const context = {
    app: `The app that the spec "${md.title ?? path}" describes. Readers are its everyday users, not developers.`,
    page: path,
    other_text_on_the_page: quoted.slice(0, 40).map((item) => item.text),
  };
  return Promise.all(
    quoted.map(async (item) => {
      const answers = await track(
        `design-copy:${path}:${item.line}`,
        { ...context, role: item.role, text: item.text },
        stringQuestions(item.role, item.text, platform),
      );
      return judgeString(item, answers, proper, platform);
    }),
  );
}

export function judgeWhole(answers: Answers, readings: Record<string, unknown>, hasScopeHeading: boolean): Issue[] {
  const issues: Issue[] = [];
  const get = reader(answers, readings);
  const add = (severity: Issue["severity"], part: string, message: string, key: string, value: number) =>
    issues.push({ severity, part, message, source: jevSource(key, value) });

  const human = get("sounds_human");
  if (human < T.humanError)
    add("error", "voice", "Reads as AI-written. Say plainly what will be built and why.", "sounds_human", human);
  else if (human < T.humanWarn)
    add("warn", "voice", "Reads a little AI-written. Cut filler and be more direct.", "sounds_human", human);
  const filler = get("ai_filler");
  if (filler >= T.fillerWarn)
    add(
      "warn",
      "voice",
      "Uses wording typical of AI text (robust, seamless, comprehensive, leverage...).",
      "ai_filler",
      filler,
    );
  const intent = get("states_intent");
  if (intent < T.intentWarn)
    add(
      "warn",
      "intent",
      "Never says what problem this solves or what the people it is for want.",
      "states_intent",
      intent,
    );
  const scope = get("states_out_of_scope");
  if (scope < T.scopeWarn && !hasScopeHeading)
    add("warn", "scope", "Never says what is out of scope.", "states_out_of_scope", scope);
  return issues;
}

export function judgeSection(answers: Answers, readings: Record<string, unknown>, part: string): Issue[] {
  const issues: Issue[] = [];
  const get = reader(answers, readings);
  const add = (message: string, key: string, value: number) =>
    issues.push({ severity: "warn", part, message, source: jevSource(key, value) });
  const open = get("open_decision");
  if (open >= T.openWarn) add("Leaves a decision open without saying so.", "open_decision", open);
  if (!answers.concrete) return issues;
  const concrete = get("concrete");
  if (concrete < T.concreteWarn) add("Vague: says what it wants, not what exactly happens.", "concrete", concrete);
  const untestable = get("untestable");
  if (untestable >= T.untestableWarn)
    add("States an outcome a tester could not check as pass or fail.", "untestable", untestable);
  const builds = choice(answers, "two_builds");
  const two = (readings.two_builds =
    (builds.probabilities.different_behaviour ?? 0) + (builds.probabilities.different_things ?? 0)) as number;
  if (two >= T.twoBuildsWarn) add("Two engineers could build different things from this.", "two_builds", two);
  return issues;
}

// Preserve capitalized names inferred from the spec when judging its UI copy.
function properNouns(text: string): Set<string> {
  const names = [...text.matchAll(/(?<=[\p{Ll},;:)] )\p{Lu}[\p{L}\p{N}.'’-]*/gu)].map((match) =>
    match[0].replace(/[.'’-]+$/, ""),
  );

  const acronyms = text.match(/\b\p{Lu}{2,5}\b/gu) ?? [];
  return new Set(["I", "OK", ...names, ...acronyms]);
}
