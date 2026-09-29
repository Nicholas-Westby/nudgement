import { type CopyRole, type CopyString, extractCopy } from "./copy-extract";
import { stringQuestions } from "./copy-questions";
import { ALWAYS_PROPER, judgeString } from "./copy-rules";
import type { Issue } from "./message";
import { type JevStats, startRun } from "./run";

const MAX_STRINGS = 120;

export interface CopyOptions {
  tag?: string;
  /** What the app is and who reads it, so Jev judges words for the right audience. */
  app?: string;
  /** Names that keep their capitals, such as product names. */
  properNouns?: string[];
  /** Only strings on these lines (from a commit's diff). */
  touched?: Set<number>;
}

export interface CopyResult {
  text: string;
  role: CopyRole;
  line: number;
  issues: Issue[];
  readings: Record<string, number>;
}

export interface CopyEvaluation {
  kind: "copy";
  runId: string;
  version: string;
  repo?: string;
  ref?: string;
  path: string;
  verdict: "pass" | "fail";
  strings: CopyResult[];
  issues: Issue[];
  jev: JevStats;
}

export type Platform = "web" | "mac";

const DEFAULT_APP: Record<Platform, string> = {
  web: "A web app. Readers are its everyday users, not developers.",
  mac: "A Mac app. Readers are its everyday users, not developers.",
};

/** `found` is the text's strings when the caller has already extracted them. */
export async function evaluateCopy(
  input: { path: string; text: string; repo?: string; ref?: string; found?: CopyString[] },
  options: CopyOptions = {},
): Promise<CopyEvaluation> {
  const { runId, version, stats, issues, track, finish } = startRun();
  const all = input.found ?? extractCopy(input.path, input.text);
  const strings = all.filter((item) => !options.touched || options.touched.has(item.line)).slice(0, MAX_STRINGS);
  const proper = new Set([...ALWAYS_PROPER, ...(options.properNouns ?? []).flatMap((name) => name.split(/\s+/))]);
  const platform: Platform = input.path.endsWith(".swift") ? "mac" : "web";

  const page = all.slice(0, 40).map((item) => item.text);
  const answers = await Promise.all(
    strings.map((item) =>
      track(
        `copy:${input.path}:${item.line}`,
        {
          app: options.app ?? DEFAULT_APP[platform],
          page: input.path,
          role: item.role,
          text: item.text,
          other_text_on_the_page: page,
        },
        stringQuestions(item.role, item.text, platform),
      ),
    ),
  );
  const results = strings.map((item, index) => judgeString(item, answers[index], proper, platform));

  const errors = [...issues, ...results.flatMap((result) => result.issues)].some((issue) => issue.severity === "error");
  const evaluation: CopyEvaluation = {
    kind: "copy",
    runId,
    version,
    repo: input.repo,
    ref: input.ref,
    path: input.path,
    verdict: errors ? "fail" : "pass",
    strings: results,
    issues,
    jev: stats,
  };
  return finish(evaluation, { tag: options.tag });
}

export { stringQuestions } from "./copy-questions";
export { COPY_THRESHOLDS, judgeString } from "./copy-rules";
