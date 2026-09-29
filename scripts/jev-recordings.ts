import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Answers, Question } from "../src/jev";

export interface Recording {
  request: { model: string; state: unknown; questions: Record<string, Question> };
  baselineCount: number;
  samples: { recordedAt: string; body: { answers: Answers; usage?: { input_tokens?: number } } }[];
}

export const fixtureDirectory = join(import.meta.dir, "..", "tests", "fixtures", "jev");
export const requestKey = (body: unknown) => createHash("sha256").update(JSON.stringify(body)).digest("hex");
const buckets = new Map<string, Record<string, Recording>>();

function bucket(prefix: string): Record<string, Recording> {
  let records = buckets.get(prefix);
  if (!records) {
    records = JSON.parse(gunzipSync(readFileSync(join(fixtureDirectory, `${prefix}.json.gz`))).toString());
    buckets.set(prefix, records!);
  }
  return records!;
}

export function readRecording(key: string): Recording {
  const recording = bucket(key[0])[key];
  if (!recording) throw Object.assign(new Error(`Missing Jev fixture: ${key}`), { code: "ENOENT" });
  return recording;
}

export function recordingKeys(): string[] {
  return [..."0123456789abcdef"].flatMap((prefix) => Object.keys(bucket(prefix))).sort();
}

/** Bucket compression shares repeated questions while keeping recordings addressable by request. */
export function writeRecording(recording: Recording): void {
  const key = requestKey(recording.request);
  let records: Record<string, Recording>;
  try { records = bucket(key[0]); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    records = {};
    buckets.set(key[0], records);
  }
  records[key] = recording;
  mkdirSync(fixtureDirectory, { recursive: true });
  const path = join(fixtureDirectory, `${key[0]}.json.gz`);
  writeFileSync(`${path}.tmp`, gzipSync(JSON.stringify(records), { level: 9 }));
  renameSync(`${path}.tmp`, path);
}
