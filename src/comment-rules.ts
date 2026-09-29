import type { FoundComment } from "./comments";
import { type CommentResult, T } from "./commit-rules";
import { type Answers, choice } from "./jev";
import type { Issue } from "./message";
import { fmt, jevSource, reader } from "./run";

export function judgeComment(comment: FoundComment, answers: Answers | undefined): CommentResult {
  const result: CommentResult = {
    path: comment.path,
    line: comment.line,
    text: comment.text,
    issues: [],
    readings: {},
  };
  if (!answers) return result;
  const part = `comment ${comment.path}:${comment.line}`;
  const readings = result.readings;
  const get = reader(answers, readings);
  const issue = (severity: Issue["severity"], message: string, source: string) =>
    result.issues.push({ severity, part, message, source });

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

  if (narrates > T.commentNarratesError)
    issue(
      "error",
      "Describes the edit or the old code instead of the code as it is. Say why the code is this way, or delete it.",
      jevSource("narrates_change", narrates),
    );
  if (contradicts > T.commentContradictsError)
    issue(
      "warn",
      "Likely says something the code contradicts. Check it against the code.",
      jevSource("contradicts_code", contradicts),
    );
  else if (contradicts > T.commentContradictsWarn)
    issue(
      "warn",
      "May say something the code contradicts. Check it against the code.",
      jevSource("contradicts_code", contradicts),
    );
  if (human < T.commentHumanWarn)
    issue(
      "warn",
      "Reads as AI-written. Write it the way you'd leave a note for a teammate.",
      jevSource("sounds_human", human),
    );
  // API documentation and rationale can repeat code without being redundant.
  if (restates > T.commentRestatesWarn && kind.choice !== "docs" && kind.choice !== "why")
    issue(
      "warn",
      "Restates what the code already shows. Explain why, or delete it.",
      jevSource("restates_code", restates),
    );
  const deleteP = action.probabilities.delete ?? 0;
  if (deleteP > T.commentDeleteWarn && keep < T.commentDeleteKeepMax && narrates <= T.commentNarratesError)
    issue("warn", "Adds little. Consider deleting it.", `jev:action=delete@${fmt(deleteP)} worth_keeping=${fmt(keep)}`);
  else if (action.choice === "rewrite_as_why" && action.confidence > 0.5)
    issue("warn", "Rewrite it to explain why rather than what.", `jev:action=rewrite_as_why@${fmt(action.confidence)}`);
  const tooLong = length.probabilities.too_long ?? 0;
  if (tooLong > T.commentTooLongWarn)
    issue("warn", "Longer than it needs to be.", `jev:length=too_long@${fmt(tooLong)}`);
  return result;
}
