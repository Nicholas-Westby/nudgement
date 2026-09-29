import { checkChangedFiles, collectComments } from "./changed-files";
import {
  type Evaluation,
  judgeAccuracy,
  judgeComment,
  judgeStyle,
  NO_DIFF,
  type Options,
  overallScore,
} from "./commit-rules";
import { type CommitInput, linesToReview, readFileAt, usesScope, withoutMovedLines } from "./git";
import { matchesPath } from "./hygiene";
import { lint, parseMessage, sortIssues } from "./message";
import {
  accuracyQuestions,
  accuracyState,
  commentQuestions,
  commentState,
  styleQuestions,
  styleState,
  trimDiff,
} from "./questions";
import { failed } from "./report";
import { startRun } from "./run";

export async function evaluate(input: CommitInput, options: Options): Promise<Evaluation> {
  const { runId, version, stats, issues, track, finish } = startRun();
  const parsed = parseMessage(input.message);
  issues.push(...lint(parsed, options.rules));
  const skipped = (path: string) => (options.ignore ?? []).some((pattern) => matchesPath(path, pattern));
  const changed = linesToReview(input.files, skipped);
  const maxChanged = options.rules?.maxChangedLines ?? 1000;
  if (changed > maxChanged) {
    issues.push({
      severity: "warn",
      part: "commit",
      message: `This commit changes ${changed} lines. A reviewer can follow smaller steps; consider splitting it.`,
      source: `lint:size=${changed}`,
    });
  }
  const { text: diff, truncated } = trimDiff(input.diffText);

  // The comment and file checks read each changed file once between them.
  const texts = new Map<string, string | undefined>();
  const textOf = (path: string) =>
    texts.has(path) ? texts.get(path) : texts.set(path, readFileAt(input.repo, path, input.ref)).get(path);
  // Code the commit only moved is judged where it was first written, not again here.
  const written = { ...input, files: withoutMovedLines(input.files) };
  const comments = options.comments ? collectComments(written, textOf).filter((comment) => !skipped(comment.path)) : [];

  const fileChecks = options.checkFiles ? checkChangedFiles(written, options, textOf) : Promise.resolve([]);
  const [style, accuracy, ...commentAnswers] = await Promise.all([
    track("commit:style", styleState(parsed), styleQuestions(parsed)),
    input.files.length
      ? track(
          "commit:accuracy",
          accuracyState(parsed, input.files, diff.trim() ? diff : NO_DIFF),
          accuracyQuestions(parsed),
        )
      : Promise.resolve(undefined),
    ...comments.map((comment) =>
      track(`comment:${comment.path}:${comment.line}`, commentState(comment), commentQuestions()),
    ),
  ]);

  const readings: Record<string, unknown> = {};
  if (style) issues.push(...judgeStyle(parsed, style, readings));
  if (accuracy)
    issues.push(
      ...judgeAccuracy(parsed, accuracy, readings, {
        diffCut: truncated.length > 0,
        oneNewFile: input.files.length === 1 && input.files[0].removed === 0,
        houseScope:
          !!parsed.scope &&
          usesScope(
            input.repo,
            input.ref,
            parsed.scope,
            input.files.map((file) => file.path),
          ),
      }),
    );
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

export { withoutMachineRead } from "./changed-files";
export type { CommentResult, Evaluation, Options } from "./commit-rules";
export { judgeComment, THRESHOLDS } from "./commit-rules";
