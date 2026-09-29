/** Jev transport, bounded concurrency and retry handling. Requests and answers are logged for diagnosis. */

import { validateAnswers } from "./jev-response";
import { logCall } from "./log";

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-latest";

// Retry stalled requests after eight seconds; normal responses in the baseline were much faster.
const TIMEOUT_MS = 8_000;
const RETRIES = 3;

// Bound concurrent requests when a file or commit range fans out. This is not a rate limiter.
const MAX_IN_FLIGHT = 32;
let inFlight = 0;
const waiting: (() => void)[] = [];

async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => waiting.push(resolve));
  else inFlight++;
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    // Hand the occupied slot directly to a waiter; decrement only when nobody is queued.
    if (next) next();
    else inFlight--;
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
  const key = process.env.JEV_API_KEY?.trim() || process.env.TYPESAFE_API_KEY?.trim();
  if (!key) throw new Error("Set JEV_API_KEY or TYPESAFE_API_KEY in the environment or nudgement's .env");
  return key;
}

/** Label requests by review target so their logged answers can be traced to a finding. */
export function askJev(
  runId: string,
  label: string,
  state: unknown,
  questions: Record<string, Question>,
): Promise<JevResult> {
  return slot(() => send(runId, label, state, questions));
}

async function send(
  runId: string,
  label: string,
  state: unknown,
  questions: Record<string, Question>,
): Promise<JevResult> {
  const key = apiKey();
  const body = { model: JEV_MODEL, state, questions };
  const started = Date.now();
  let lastError = "";
  let attempts = 0;

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await Bun.sleep(500 * 2 ** attempt);
    attempts++;
    try {
      const response = await fetch(JEV_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
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
      const parsed = JSON.parse(text) as { answers?: unknown; usage?: { input_tokens?: number } };
      const answers = validateAnswers(parsed.answers, questions);
      const result = {
        answers,
        inputTokens: parsed.usage?.input_tokens ?? 0,
        ms: Date.now() - started,
      };
      logCall({
        runId,
        label,
        request: body,
        answers: result.answers,
        inputTokens: result.inputTokens,
        ms: result.ms,
        attempts,
      });
      return result;
    } catch (error) {
      lastError = String(error);
    }
  }

  logCall({ runId, label, request: body, error: lastError, ms: Date.now() - started, attempts });
  throw new Error(`Jev request ${label} failed: ${lastError}`);
}

export function noul(answers: Answers, key: string): number {
  const answer = answers[key];
  if (answer?.type !== "noul") throw new Error(`Jev gave no noul for ${key}`);
  return answer.noul;
}

export function choice(answers: Answers, key: string): ChoiceAnswer {
  const answer = answers[key];
  if (answer?.type !== "choice") throw new Error(`Jev gave no choice for ${key}`);
  return answer;
}

export function score(answers: Answers, key: string): ScoreAnswer {
  const answer = answers[key];
  if (answer?.type !== "score") throw new Error(`Jev gave no score for ${key}`);
  return answer;
}
