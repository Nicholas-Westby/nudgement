import type { Answers, Question } from "./jev";

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const probability = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

/** Reject incomplete answers before a review can silently omit a question. */
export function validateAnswers(value: unknown, questions: Record<string, Question>): Answers {
  if (!object(value)) throw new Error("response had no answers");
  for (const [key, question] of Object.entries(questions)) {
    const answer = value[key];
    if (!object(answer) || answer.type !== question.type) throw new Error(`Invalid Jev answer for ${key}`);
    if (question.type === "noul") {
      if (!probability(answer.noul)) throw new Error(`Invalid Jev probability for ${key}`);
    } else {
      if (
        !probability(answer.confidence) ||
        !object(answer.probabilities) ||
        !Object.values(answer.probabilities).every(probability)
      )
        throw new Error(`Invalid Jev distribution for ${key}`);
      if (
        question.type === "choice" &&
        (typeof answer.choice !== "string" || !Object.hasOwn(question.criteria, answer.choice))
      ) {
        throw new Error(`Invalid Jev choice for ${key}`);
      }
      if (question.type === "score" && (typeof answer.score !== "number" || !Number.isFinite(answer.score))) {
        throw new Error(`Invalid Jev score for ${key}`);
      }
    }
  }
  return value as Answers;
}
