import { T } from "./commit-rules";
import { type Answers, choice } from "./jev";
import type { Issue, ParsedMessage } from "./message";
import { jevSource, reader } from "./run";

export function judgeStyle(parsed: ParsedMessage, answers: Answers, readings: Record<string, unknown>): Issue[] {
  const issues: Issue[] = [];
  const get = reader(answers, readings);
  const issue = (severity: Issue["severity"], part: string, message: string, key: string, value: number) =>
    issues.push({ severity, part, message, source: jevSource(key, value) });

  const human = get("sounds_human");
  if (human < T.humanError)
    issue(
      "error",
      "human",
      "The message reads as AI-written. Say plainly and briefly what changed.",
      "sounds_human",
      human,
    );
  else if (human < T.humanWarn)
    issue(
      "warn",
      "human",
      "The message reads a little AI-written. Cut filler and be more direct.",
      "sounds_human",
      human,
    );

  const filler = get("ai_filler");
  if (filler >= T.fillerError)
    issue(
      "error",
      "human",
      "Uses wording typical of AI text (robust, enhance, ensure, comprehensive, properly...). Say concretely what changed.",
      "ai_filler",
      filler,
    );
  else if (filler >= T.fillerWarn)
    issue("warn", "human", "Has a hint of AI wording. Check for filler words and vague claims.", "ai_filler", filler);
  const vague = get("vague_benefits");
  if (vague > T.vagueWarn)
    issue("warn", "human", "Claims benefits without saying concretely what changed.", "vague_benefits", vague);
  const long = get("over_explained");
  if (long > T.overExplainedWarn)
    issue("warn", "body", "Longer than it needs to be. Cut it down to what a reviewer needs.", "over_explained", long);
  const imperative = get("subject_imperative");
  // Jev mistakes noun-like verbs such as "plan" and "pin"; exact rules handle imperative mood.
  const plainWord = /^[a-z]+\b/.test(parsed.subject ?? "");
  if (imperative < 0.3 && !plainWord)
    issue(
      "warn",
      "subject",
      'Write the subject in the imperative mood ("add X", not "added X").',
      "subject_imperative",
      imperative,
    );
  const generic = get("subject_generic");
  if (generic > T.genericWarn)
    issue("warn", "subject", "The subject is generic. Name what actually changed.", "subject_generic", generic);

  const tone = choice(answers, "tone");
  readings.tone = { choice: tone.choice, probabilities: tone.probabilities };

  if (parsed.bullets.length) {
    const repeat = get("bullets_repeat_subject");
    if (repeat > 0.7)
      issue(
        "warn",
        "body",
        "The bullets mostly repeat the subject. Drop them or say something new.",
        "bullets_repeat_subject",
        repeat,
      );
  }
  parsed.bullets.forEach((_, index) => {
    const key = `bullet_${index + 1}_human`;
    const value = get(key);
    if (value < T.bulletHumanWarn)
      issue("warn", `bullet ${index + 1}`, `Bullet ${index + 1} reads as AI-written.`, key, value);
  });
  return issues;
}
