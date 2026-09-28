/**
 * Runs one evaluation: lint, then every Jev request in parallel (one for the
 * message's style, one for its accuracy against the diff, one per comment),
 * then turns the probabilities into issues. Thresholds are in THRESHOLDS so
 * they can be tuned from the logs.
 */

import { grepArgs, linesToReview, readFileAt, type CommitInput, usesScope, withoutMovedLines } from "./git";
import { evaluateFile, type FileEvaluation } from "./code-evaluate";
import { evaluateReadme, findReadme, type ReadmeEvaluation } from "./readme-evaluate";
import { evaluateDesign, type DesignEvaluation } from "./design-evaluate";
import { evaluatePlan, type PlanEvaluation } from "./plan-evaluate";
import { planningDocKind } from "./plan-parse";
import { evaluateTests, type TestFileEvaluation } from "./test-evaluate";
import { isTestFile } from "./test-parse";
import { matchesPath } from "./hygiene";
import { evaluateCopy, type CopyEvaluation, type CopyOptions } from "./copy-evaluate";
import { extractCopy } from "./copy-extract";
import { choice, noul, score, type Answers } from "./jev";
import { fmt, jevSource, reader, startRun, type JevStats } from "./run";
import { lint, parseMessage, sortIssues, type CommitRules, type Issue, type ParsedMessage } from "./message";
import { findComments, type FoundComment } from "./comments";
import { failed } from "./report";
import {
  accuracyQuestions,
  accuracyState,
  commentQuestions,
  commentState,
  styleQuestions,
  styleState,
  trimDiff,
} from "./questions";

export const THRESHOLDS = {
  // Benchmarked 2026-09-26: good messages read 0.82 to 0.90 on sounds_human
  // and at most 0.05 on ai_filler; AI-written ones 0.35 to 0.82 and 0.06 to 0.95.
  // In real use a plain "test: enforce file size, complexity..." read 0.12 on
  // ai_filler, so the error sits at 0.2 and the lower readings only warn.
  humanError: 0.6,
  humanWarn: 0.7,
  fillerError: 0.2,
  fillerWarn: 0.08,
  bulletHumanWarn: 0.7,
  vagueWarn: 0.7,
  overExplainedWarn: 0.7,
  genericWarn: 0.7,
  typeFitsError: 0.25,
  typeFitsWarn: 0.6,
  bestTypeConfidence: 0.6,
  // In the bench, correctly typed commits flagged by type_fits had their own type
  // read at 0.74 and up, wrongly typed ones at 0.59 and below.
  ownTypeClear: 0.7,
  subjectAccurateError: 0.5,
  subjectAccurateWarn: 0.72,
  subjectSpecificityWarn: 1.35,
  mainChangeWarn: 0.4,
  unsupportedError: 0.75,
  unsupportedWarn: 0.5,
  omitsWarn: 0.7,
  listsFilesWarn: 0.7,
  splitWarn: 0.75,
  bulletCountWarn: 0.6,
  scopeFitsWarn: 0.4,
  scopeNeededInfo: 0.8,
  bulletAccurateError: 0.35,
  bulletAddsInfoWarn: 0.35,
  commentNarratesError: 0.7,
  commentHumanWarn: 0.4,
  commentRestatesWarn: 0.75,
  // Labelled bad comments Jev said to delete read 0.61 and up on delete and 0.54 at most on
  // worth_keeping; good ones it misjudged in real use read 0.56 to 0.60, or 0.61 and up on worth_keeping.
  commentDeleteWarn: 0.6,
  commentDeleteKeepMax: 0.58,
  // On 51 clear labelled comments, no accurate one read above 0.69 and only blatant
  // contradictions passed 0.85; subtle ones read as low as 0.1, so a pass proves little.
  // Above 0.85 it caught 1 of 18 labelled contradictions, and its one error in real
  // use (0.91, on an accurate comment beside an else branch) was wrong, so it only warns.
  commentContradictsError: 0.85,
  commentContradictsWarn: 0.7,
  commentTooLongWarn: 0.6,
};

const T = THRESHOLDS;

// Sent when every changed file is a lockfile or generated file, whose diff is left out.
const NO_DIFF = "(Only lockfiles or generated files changed. Their diff is left out; judge from changed_files.)";

export interface CommentResult {
  path: string;
  line: number;
  text: string;
  issues: Issue[];
  readings: Record<string, unknown>;
}

export interface Evaluation {
  runId: string;
  version: string;
  repo: string;
  ref: string;
  message: string;
  verdict: "pass" | "fail";
  /** 0 to 100. A rough single number for comparing attempts, not a grade to chase. */
  score: number;
  issues: Issue[];
  comments: CommentResult[];
  readings: Record<string, unknown>;
  diffTruncated: string[];
  /** With checkFiles: the bloat check of each code file the commit changed, and the check of any README it changed. */
  files: (FileEvaluation | ReadmeEvaluation | TestFileEvaluation | CopyEvaluation | DesignEvaluation | PlanEvaluation)[];
  jev: JevStats;
}

export interface Options {
  comments: boolean;
  /** Also judge each changed code file for bloat. */
  checkFiles?: boolean;
  /** Passed to the file checks: what the project must do. */
  context?: string;
  /** Passed to the README check: content the README must cover. */
  requirements?: string[];
  rules?: CommitRules & { maxChangedLines?: number };
  /** Settings for the copy check of changed views. */
  copy?: Pick<CopyOptions, "app" | "properNouns">;
  /** Paths whose comments and contents are not judged, such as test fixtures. */
  ignore?: string[];
  /** Used by the benchmark to label runs so they can be told apart from real use. */
  tag?: string;
}


export async function evaluate(input: CommitInput, options: Options): Promise<Evaluation> {
  const { runId, version, stats, issues, track, finish } = startRun();
  const parsed = parseMessage(input.message);
  issues.push(...lint(parsed, options.rules));
  const skipped = (path: string) => (options.ignore ?? []).some((pattern) => matchesPath(path, pattern));
  const changed = linesToReview(input.files, skipped);
  const maxChanged = options.rules?.maxChangedLines ?? 1000;
  if (changed > maxChanged) {
    issues.push({ severity: "warn", part: "commit", message: `This commit changes ${changed} lines. A reviewer can follow smaller steps; consider splitting it.`, source: `lint:size=${changed}` });
  }
  const { text: diff, truncated } = trimDiff(input.diffText);

  // The comment and file checks read each changed file once between them.
  const texts = new Map<string, string | undefined>();
  const textOf = (path: string) => (texts.has(path) ? texts.get(path) : texts.set(path, readFileAt(input.repo, path, input.ref)).get(path));
  // Code the commit only moved is judged where it was first written, not again here.
  const written = { ...input, files: withoutMovedLines(input.files) };
  const comments = options.comments ? collectComments(written, textOf).filter((comment) => !skipped(comment.path)) : [];

  const fileChecks = options.checkFiles ? checkChangedFiles(written, options, textOf) : Promise.resolve([]);
  const [style, accuracy, ...commentAnswers] = await Promise.all([
    track("commit:style", styleState(parsed), styleQuestions(parsed)),
    input.files.length
      ? track("commit:accuracy", accuracyState(parsed, input.files, diff.trim() ? diff : NO_DIFF), accuracyQuestions(parsed))
      : Promise.resolve(undefined),
    ...comments.map((comment) => track(`comment:${comment.path}:${comment.line}`, commentState(comment), commentQuestions())),
  ]);

  const readings: Record<string, unknown> = {};
  if (style) issues.push(...judgeStyle(parsed, style, readings));
  if (accuracy) issues.push(...judgeAccuracy(parsed, accuracy, readings, {
        diffCut: truncated.length > 0,
        oneNewFile: input.files.length === 1 && input.files[0].removed === 0,
        houseScope: !!parsed.scope && usesScope(input.repo, input.ref, parsed.scope, input.files.map((file) => file.path)),
      }));
  const commentResults = comments.map((comment, index) => judgeComment(comment, commentAnswers[index]));

  const files = (await fileChecks).filter((file) => file.verdict !== "skipped");
  for (const file of files) {
    stats.requests += file.jev.requests;
    stats.failed += file.jev.failed;
    stats.inputTokens += file.jev.inputTokens;
  }
  const all = [...issues, ...commentResults.flatMap((result) => result.issues)];
  const verdict = all.some((issue) => issue.severity === "error") || files.some(failed) ? "fail" : "pass";

  const evaluation: Evaluation = {
    runId,
    version,
    repo: input.repo,
    ref: input.ref,
    message: input.message,
    verdict,
    score: overallScore(issues, readings, commentResults),
    issues: sortIssues(issues),
    comments: commentResults,
    readings,
    diffTruncated: truncated,
    files,
    jev: stats,
  };
  return finish(evaluation, {
    kind: "commit",
    tag: options.tag,
    changedFiles: input.files.map((file) => file.path),
    files: files.map((file) => ({ runId: file.runId, kind: file.kind, path: file.path, verdict: file.verdict })),
  });
}

// A file the commit mostly wrote is judged whole. Otherwise only the functions
// and classes the commit touched are judged, so old bloat is not blamed on it.
const MOSTLY_NEW = 0.4;

function checkChangedFiles(input: CommitInput, options: Options, textOf: (path: string) => string | undefined): Promise<Evaluation["files"]> {
  const { tag, context, requirements } = options;
  const { ref } = input;
  return Promise.all(
    input.files
      .filter((file) => !file.binary && file.lines.some((line) => line.kind === "+") && !(options.ignore ?? []).some((pattern) => matchesPath(file.path, pattern)))
      .flatMap((file): Promise<Evaluation["files"][number]>[] => {
        const text = textOf(file.path);
        if (text === undefined) return [];
        // A design spec or a plan gets its own check, as a README gets the README check.
        const doc = planningDocKind(file.path);
        // Lines with words in them: a closing brace or a blank line is nobody's writing.
        const worded = (line: string) => /\p{L}/u.test(line);
        const touched = new Set(file.lines.filter((line) => line.kind === "+" && worded(line.text)).map((line) => line.newLine!));
        if (!touched.size) return [];
        const whole = touched.size >= MOSTLY_NEW * text.split("\n").filter(worded).length;
        if (doc === "design") return [evaluateDesign({ path: file.path, text, repo: input.repo, ref }, { tag, touched: whole ? undefined : touched })];
        if (doc === "plan") return [evaluatePlan({ path: file.path, text, repo: input.repo, ref }, { tag, touched: whole ? undefined : touched })];
        if (findReadme([file.path.split("/").pop()!])) return [evaluateReadme({ path: file.path, text, repo: input.repo, ref }, { tag, requirements, requirementsAsWarnings: true, touched: whole ? undefined : touched })];
        // Tests get the test-quality check; bloat questions mostly misfire on them.
        if (isTestFile(file.path, text)) return [evaluateTests({ path: file.path, text, repo: input.repo, ref }, { tag, touched: whole ? undefined : touched })];
        const bloat = evaluateFile({ path: file.path, text, repo: input.repo, ref }, { tag, context, touched: whole ? undefined : touched, skipFileLevel: !whole });
        // Views also get their user-facing strings judged. Any Swift file can
        // hold them (a model's error messages), so it is judged when the commit
        // touched one.
        const found = file.path.endsWith(".swift") ? extractCopy(file.path, text) : undefined;
        if (!/\.[jt]sx$/.test(file.path) && !found?.some((item) => whole || touched.has(item.line))) return [bloat];
        return [bloat, evaluateCopy({ path: file.path, text, repo: input.repo, ref, found }, { tag, ...options.copy, touched: whole ? undefined : touched })];
      })
  );
}

function collectComments(input: CommitInput, textOf: (path: string) => string | undefined): FoundComment[] {
  const found: FoundComment[] = [];
  for (const file of input.files) {
    if (!file.lines.some((line) => line.kind === "+")) continue;
    found.push(...findComments(file, textOf(file.path)?.split("\n")));
  }
  return withoutMachineRead(input.repo, input.ref, found);
}

// A comment led by a tag, such as "// no-help: text label visible".
const TAGGED = /^\s*(\/\/|#|--)\s*([\w-]+):/;

/** Drops tagged comments that code elsewhere searches for by their tag in quotes, such as a test that exempts buttons marked "// no-help:". Their words are an instruction to that code. */
export function withoutMachineRead(repo: string, ref: string, comments: FoundComment[]): FoundComment[] {
  const read = new Map<string, boolean>();
  const isRead = (marker: string, tag: string) => {
    const key = `${marker} ${tag}`;
    if (!read.has(key)) {
      const result = Bun.spawnSync(["git", "-C", repo, "grep", "-q", "-F", "-e", `"${marker} ${tag}:`, "-e", `"${tag}:`, ...grepArgs(ref), "--", "."]);
      read.set(key, result.exitCode === 0);
    }
    return read.get(key)!;
  };
  return comments.filter((comment) => {
    const match = TAGGED.exec(comment.text);
    return !match || !isRead(match[1], match[2]);
  });
}

function judgeStyle(parsed: ParsedMessage, answers: Answers, readings: Record<string, unknown>): Issue[] {
  const issues: Issue[] = [];
  const get = reader(answers, readings);
  const issue = (severity: Issue["severity"], part: string, message: string, key: string, value: number) =>
    issues.push({ severity, part, message, source: jevSource(key, value) });

  const human = get("sounds_human");
  if (human < T.humanError) issue("error", "human", "The message reads as AI-written. Say plainly and briefly what changed.", "sounds_human", human);
  else if (human < T.humanWarn) issue("warn", "human", "The message reads a little AI-written. Cut filler and be more direct.", "sounds_human", human);

  const filler = get("ai_filler");
  if (filler >= T.fillerError) issue("error", "human", "Uses wording typical of AI text (robust, enhance, ensure, comprehensive, properly...). Say concretely what changed.", "ai_filler", filler);
  else if (filler >= T.fillerWarn) issue("warn", "human", "Has a hint of AI wording. Check for filler words and vague claims.", "ai_filler", filler);
  const vague = get("vague_benefits");
  if (vague > T.vagueWarn) issue("warn", "human", "Claims benefits without saying concretely what changed.", "vague_benefits", vague);
  const long = get("over_explained");
  if (long > T.overExplainedWarn) issue("warn", "body", "Longer than it needs to be. Cut it down to what a reviewer needs.", "over_explained", long);
  const imperative = get("subject_imperative");
  // Jev misreads a verb that is also a noun ("plan X", "pin X"), and code already
  // catches "added" and "updating", so a plain lowercase first word is left to code.
  const plainWord = /^[a-z]+\b/.test(parsed.subject ?? "");
  if (imperative < 0.3 && !plainWord) issue("warn", "subject", 'Write the subject in the imperative mood ("add X", not "added X").', "subject_imperative", imperative);
  const generic = get("subject_generic");
  if (generic > T.genericWarn) issue("warn", "subject", "The subject is generic. Name what actually changed.", "subject_generic", generic);

  const tone = choice(answers, "tone");
  readings.tone = { choice: tone.choice, probabilities: tone.probabilities };

  if (parsed.bullets.length) {
    const repeat = get("bullets_repeat_subject");
    if (repeat > 0.7) issue("warn", "body", "The bullets mostly repeat the subject. Drop them or say something new.", "bullets_repeat_subject", repeat);
  }
  parsed.bullets.forEach((_, index) => {
    const key = `bullet_${index + 1}_human`;
    const value = get(key);
    if (value < T.bulletHumanWarn) issue("warn", `bullet ${index + 1}`, `Bullet ${index + 1} reads as AI-written.`, key, value);
  });
  return issues;
}

function judgeAccuracy(parsed: ParsedMessage, answers: Answers, readings: Record<string, unknown>, diff: { diffCut: boolean; oneNewFile: boolean; houseScope: boolean }): Issue[] {
  const issues: Issue[] = [];
  const get = reader(answers, readings);
  const issue = (severity: Issue["severity"], part: string, message: string, key: string, value: number) =>
    issues.push({ severity, part, message, source: jevSource(key, value) });

  const typeFits = get("type_fits");
  const best = choice(answers, "best_type");
  readings.best_type = { choice: best.choice, confidence: best.confidence, probabilities: best.probabilities };
  // type_fits alone misfires when something else about the message is off, so
  // an error needs Jev to also prefer a different type with some confidence,
  // and nothing is said when it clearly prefers the type used.
  const prefersOther = best.choice !== parsed.type && best.confidence >= T.bestTypeConfidence;
  const suggestion = prefersOther ? ` Consider "${best.choice}".` : "";
  const ownTypeClear = !!parsed.type && (best.probabilities[parsed.type] ?? 0) >= T.ownTypeClear;
  if (!ownTypeClear && parsed.type && (typeFits < T.typeFitsError || (prefersOther && typeFits < T.typeFitsWarn))) {
    issue("error", "type", `The type "${parsed.type}" does not fit this change.${suggestion}`, "type_fits", typeFits);
  } else if (!ownTypeClear && parsed.type && typeFits < T.typeFitsWarn) {
    issue("warn", "type", `The type "${parsed.type}" may not fit this change.${suggestion}`, "type_fits", typeFits);
  }

  const accurate = get("subject_accurate");
  const main = get("subject_main_change");
  // A low accuracy reading alone misread "the order they arrived" in real use.
  // Every inaccurate subject in the benchmark also showed as an unsupported
  // claim or a side detail, so the error needs one of those, or a very low reading.
  const backed = answers.claims_unsupported && (noul(answers, "claims_unsupported") >= 0.4 || main < 0.4 || accurate < 0.2);
  if (accurate < T.subjectAccurateError && backed) issue("error", "subject", "The subject does not describe what the diff does.", "subject_accurate", accurate);
  // Where the diff was cut, Jev cannot see all the subject describes: 5 of 47 such
  // runs drew this warning, against 2% of whole diffs, and all 5 were accurate.
  else if (accurate < T.subjectAccurateWarn && !diff.diffCut) issue("warn", "subject", "The subject may not match what the diff does.", "subject_accurate", accurate);
  if (main < T.mainChangeWarn) issue("warn", "subject", "The subject names a side detail. Lead with the main change.", "subject_main_change", main);

  const specificity = score(answers, "subject_specificity");
  readings.subject_specificity = specificity.score;
  if (specificity.score < T.subjectSpecificityWarn) {
    issues.push({ severity: "warn", part: "subject", message: "The subject is vague. Say what changed and where.", source: `jev:subject_specificity=${fmt(specificity.score)}/3` });
  }

  const unsupported = get("claims_unsupported");
  if (unsupported > T.unsupportedError) issue("error", "body", "The message claims something the diff does not show.", "claims_unsupported", unsupported);
  else if (unsupported > T.unsupportedWarn) issue("warn", "body", "The message may claim something the diff does not show.", "claims_unsupported", unsupported);
  const omits = get("omits_major_change");
  if (omits > T.omitsWarn) issue("warn", "body", "The diff has a significant change the message does not mention.", "omits_major_change", omits);
  const lists = get("lists_files");
  if (lists > T.listsFilesWarn) issue("warn", "body", "Lists edits one by one. Summarize the change instead.", "lists_files", lists);
  const split = get("should_split");
  // One new file, such as a design document, is one piece of work however many topics it covers.
  if (split > T.splitWarn && !diff.oneNewFile) issue("warn", "commit", "The diff seems to hold unrelated changes. Consider separate commits.", "should_split", split);

  const why = choice(answers, "why_given");
  readings.why_given = { choice: why.choice, probabilities: why.probabilities };
  if (why.choice === "why_missing" && why.confidence > 0.6) {
    issues.push({ severity: "info", part: "body", message: "A reviewer would want to know why. Consider one bullet with the reason.", source: `jev:why_given=why_missing@${fmt(why.confidence)}` });
  }

  const bullets = choice(answers, "bullet_count");
  readings.bullet_count = { choice: bullets.choice, probabilities: bullets.probabilities };
  if (bullets.choice !== "right" && bullets.confidence > T.bulletCountWarn) {
    const text = bullets.choice === "fewer" ? "Use fewer bullets; some do not earn their place." : "Add a bullet: something a reviewer needs is missing.";
    issues.push({ severity: bullets.choice === "fewer" ? "warn" : "info", part: "body", message: text, source: `jev:bullet_count=${bullets.choice}@${fmt(bullets.confidence)}` });
  }

  if (parsed.scope) {
    const fits = get("scope_fits");
    const assessment = choice(answers, "scope_assessment");
    readings.scope_assessment = { choice: assessment.choice, probabilities: assessment.probabilities };
    // A scope earlier commits to these files use is the repo's own name for them.
    if (fits < T.scopeFitsWarn && !diff.houseScope) {
      const why = assessment.choice === "fits" ? "" : ` It looks ${assessment.choice.replace("_", " ")}.`;
      issue("warn", "scope", `The scope "${parsed.scope}" does not fit the area changed.${why}`, "scope_fits", fits);
    }
  } else {
    const needed = get("scope_needed");
    if (needed > T.scopeNeededInfo) issue("info", "scope", "The change sits in one clear area. A scope would help.", "scope_needed", needed);
  }

  parsed.bullets.forEach((_, index) => {
    const n = index + 1;
    const accurateKey = `bullet_${n}_accurate`;
    const value = get(accurateKey);
    if (value < T.bulletAccurateError) issue("error", `bullet ${n}`, `Bullet ${n} describes a change the diff does not make.`, accurateKey, value);
    const infoKey = `bullet_${n}_adds_info`;
    const adds = get(infoKey);
    if (adds < T.bulletAddsInfoWarn) issue("warn", `bullet ${n}`, `Bullet ${n} adds little beyond the subject. Consider dropping it.`, infoKey, adds);
  });

  const overall = score(answers, "overall");
  readings.overall = overall.score;
  const weakest = choice(answers, "weakest_part");
  readings.weakest_part = { choice: weakest.choice, confidence: weakest.confidence, probabilities: weakest.probabilities };
  if (weakest.choice !== "nothing") {
    issues.push({ severity: "info", part: weakest.choice.replace("_", " "), message: `Most in need of improvement: ${weakest.choice.replace("_", " ")}.`, source: `jev:weakest_part=${weakest.choice}@${fmt(weakest.confidence)}` });
  }
  return issues;
}

export function judgeComment(comment: FoundComment, answers: Answers | undefined): CommentResult {
  const result: CommentResult = { path: comment.path, line: comment.line, text: comment.text, issues: [], readings: {} };
  if (!answers) return result;
  const part = `comment ${comment.path}:${comment.line}`;
  const readings = result.readings;
  const get = reader(answers, readings);
  const issue = (severity: Issue["severity"], message: string, source: string) => result.issues.push({ severity, part, message, source });

  const kind = choice(answers, "kind");
  const action = choice(answers, "action");
  const length = choice(answers, "length");
  readings.kind = kind.choice;
  readings.kind_probabilities = kind.probabilities;
  readings.action = action.choice;
  readings.action_probabilities = action.probabilities;
  readings.length = length.choice;

  const narrates = get("narrates_change");
  const human = get("sounds_human");
  const restates = get("restates_code");
  const keep = get("worth_keeping");
  const contradicts = get("contradicts_code");

  if (narrates > T.commentNarratesError) issue("error", "Describes the edit or the old code instead of the code as it is. Say why the code is this way, or delete it.", jevSource("narrates_change", narrates));
  if (contradicts > T.commentContradictsError) issue("warn", "Likely says something the code contradicts. Check it against the code.", jevSource("contradicts_code", contradicts));
  else if (contradicts > T.commentContradictsWarn) issue("warn", "May say something the code contradicts. Check it against the code.", jevSource("contradicts_code", contradicts));
  if (human < T.commentHumanWarn) issue("warn", "Reads as AI-written. Write it the way you'd leave a note for a teammate.", jevSource("sounds_human", human));
  // A doc comment names what the code shows on purpose, and a why comment gives reasons the code cannot.
  if (restates > T.commentRestatesWarn && kind.choice !== "docs" && kind.choice !== "why") issue("warn", "Restates what the code already shows. Explain why, or delete it.", jevSource("restates_code", restates));
  const deleteP = action.probabilities.delete ?? 0;
  if (deleteP > T.commentDeleteWarn && keep < T.commentDeleteKeepMax && narrates <= T.commentNarratesError) issue("warn", "Adds little. Consider deleting it.", `jev:action=delete@${fmt(deleteP)} worth_keeping=${fmt(keep)}`);
  else if (action.choice === "rewrite_as_why" && action.confidence > 0.5) issue("warn", "Rewrite it to explain why rather than what.", `jev:action=rewrite_as_why@${fmt(action.confidence)}`);
  const tooLong = length.probabilities.too_long ?? 0;
  if (tooLong > T.commentTooLongWarn) issue("warn", "Longer than it needs to be.", `jev:length=too_long@${fmt(tooLong)}`);
  return result;
}

function overallScore(issues: Issue[], readings: Record<string, unknown>, comments: CommentResult[]): number {
  const human = typeof readings.sounds_human === "number" ? readings.sounds_human : 0.5;
  const overall = typeof readings.overall === "number" ? readings.overall / 3 : 0.5;
  const accurate = typeof readings.subject_accurate === "number" ? readings.subject_accurate : 0.5;
  const lintErrors = issues.filter((issue) => issue.severity === "error" && issue.source.startsWith("lint:")).length;
  const commentErrors = comments.flatMap((comment) => comment.issues).filter((issue) => issue.severity === "error").length;
  const raw = 0.35 * human + 0.35 * overall + 0.3 * accurate - 0.15 * lintErrors - 0.05 * commentErrors;
  return Math.max(0, Math.min(100, Math.round(raw * 100)));
}
