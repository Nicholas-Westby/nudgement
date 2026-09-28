/**
 * The TypeSafe Jev client. Every call is written to the log whether it worked
 * or not, so a strange verdict can be traced back to the exact request and
 * the probabilities that produced it.
 */

import { logCall } from "./log";

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-latest";

// Across the first 1,100 calls the slowest answer took 0.8 s, even for
// requests over 8,000 tokens. A batch that hung until a 30 s timeout then
// answered at once on retry, so give up early and try again.
const TIMEOUT_MS = 8_000;
const RETRIES = 3;

// One file can fan out into dozens of requests, and a range of commits into
// hundreds. TypeSafe allows 1,200 a minute; this keeps bursts well inside that.
const MAX_IN_FLIGHT = 32;
let inFlight = 0;
const waiting: (() => void)[] = [];

async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => waiting.push(resolve));
  inFlight++;
  try {
    return await work();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

export type NoulQuestion = {
  type: "noul";
  instructions: unknown;
  criteria?: { true: unknown; false: unknown };
};
export type ChoiceQuestion = { type: "choice"; instructions: unknown; criteria: Record<string, unknown> };
export type ScoreQuestion = { type: "score"; instructions: unknown; criteria: unknown[] };
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type NoulAnswer = { type: "noul"; noul: number };
export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};
export type ScoreAnswer = {
  type: "score";
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
};
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;
export type Answers = Record<string, Answer>;

export interface JevResult {
  answers: Answers;
  inputTokens: number;
  ms: number;
}

function apiKey(): string {
  const key = process.env.JEV_API_KEY ?? process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error("JEV_API_KEY is not set (expected in the evaluator's .env)");
  return key.trim();
}

/**
 * One request to Jev. `label` names the request in the log, such as
 * "commit:style" or "comment:src/app.ts:42".
 */
export function askJev(runId: string, label: string, state: unknown, questions: Record<string, Question>): Promise<JevResult> {
  return slot(() => send(runId, label, state, questions));
}

async function send(runId: string, label: string, state: unknown, questions: Record<string, Question>): Promise<JevResult> {
  const body = { model: JEV_MODEL, state, questions };
  const started = Date.now();
  let lastError = "";

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await Bun.sleep(500 * 2 ** attempt);
    try {
      const response = await fetch(JEV_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await response.text();
      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${text.slice(0, 500)}`;
        // Only rate limits, overload and server errors are worth another try.
        if (response.status === 429 || response.status >= 500) continue;
        break;
      }
      const parsed = JSON.parse(text) as { answers?: Answers; usage?: { input_tokens?: number } };
      if (!parsed.answers) {
        lastError = "response had no answers";
        continue;
      }
      const result = {
        answers: parsed.answers,
        inputTokens: parsed.usage?.input_tokens ?? 0,
        ms: Date.now() - started,
      };
      logCall({ runId, label, request: body, answers: result.answers, inputTokens: result.inputTokens, ms: result.ms, attempts: attempt + 1 });
      return result;
    } catch (error) {
      lastError = String(error);
    }
  }

  logCall({ runId, label, request: body, error: lastError, ms: Date.now() - started, attempts: RETRIES + 1 });
  throw new Error(`Jev request ${label} failed: ${lastError}`);
}

export function noul(answers: Answers, key: string): number {
  const answer = answers[key];
  if (!answer || answer.type !== "noul") throw new Error(`Jev gave no noul for ${key}`);
  return answer.noul;
}

export function choice(answers: Answers, key: string): ChoiceAnswer {
  const answer = answers[key];
  if (!answer || answer.type !== "choice") throw new Error(`Jev gave no choice for ${key}`);
  return answer;
}

export function score(answers: Answers, key: string): ScoreAnswer {
  const answer = answers[key];
  if (!answer || answer.type !== "score") throw new Error(`Jev gave no score for ${key}`);
  return answer;
}
