import { expect, test } from "bun:test";
import type { Question } from "../src/jev";
import { validateAnswers } from "../src/jev-response";

const questions: Record<string, Question> = {
  clear: { type: "noul", instructions: "Clear?" },
  action: { type: "choice", instructions: "Action?", criteria: { keep: "Keep", rewrite: "Rewrite" } },
  length: { type: "score", instructions: "Length?", criteria: ["Short", "Long"] },
};
const answers = {
  clear: { type: "noul", noul: 0.7 },
  action: { type: "choice", choice: "keep", confidence: 0.8, probabilities: { keep: 0.9, rewrite: 0.1 } },
  length: { type: "score", score: 0.8, confidence: 0.6, probabilities: { 0: 0.2, 1: 0.8 } },
};

test.each([
  { label: "missing question", key: "clear", answer: undefined },
  { label: "wrong answer type", key: "clear", answer: { type: "choice" } },
  { label: "out-of-range probability", key: "clear", answer: { type: "noul", noul: 1.1 } },
  { label: "unknown choice", key: "action", answer: { ...answers.action, choice: "delete" } },
  { label: "invalid distribution", key: "action", answer: { ...answers.action, probabilities: { keep: -1 } } },
  { label: "non-finite score", key: "length", answer: { ...answers.length, score: NaN } },
])("rejects a $label", ({ key, answer }) => {
  expect(() => validateAnswers({ ...answers, [key]: answer }, questions)).toThrow();
});
