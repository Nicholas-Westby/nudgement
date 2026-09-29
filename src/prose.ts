import type { CopyResult } from "./copy-evaluate";
import type { CopyString } from "./copy-extract";
import { noul } from "./jev";
import { proseQuestions } from "./prose-questions";
import { jevSource, type Track } from "./run";

const PASSAGES_PER_REQUEST = 8;
// Keep terse labels out of a prose review. They rarely contain a claim to assess.
const MIN_WORDS = 6;
// Calibrated on four responses per labelled prose case; these cutoffs are review suggestions.
export const PROSE_THRESHOLDS = { setup: 0.6, vague: 0.45 };
const CHECKS = [
  { key: "setup", message: "Drop the rhetorical setup. State the useful information directly." },
  { key: "vague", message: "Replace the abstract claim with what the tool does, checks or changes." },
] as const;

/** Add findings to the corresponding copy results in place, keeping original indices after filtering.
 * Separate requests preserve the existing copy questions and their benchmark recordings.
 */
export async function reviewProse(
  path: string,
  strings: CopyString[],
  results: CopyResult[],
  app: string,
  track: Track,
): Promise<void> {
  const eligible = strings
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item }) => ["text", "heading", "title"].includes(item.role) && item.text.split(/\s+/).length >= MIN_WORDS,
    );
  for (let offset = 0; offset < eligible.length; offset += PASSAGES_PER_REQUEST) {
    const batch = eligible.slice(offset, offset + PASSAGES_PER_REQUEST);
    const passages = batch.map(({ item }) => item);
    // Explicit passage names prevent the model from interpreting array positions as one-based.
    const answers = await track(
      `prose:${path}:${offset}`,
      {
        app,
        passages: Object.fromEntries(passages.map((item, index) => [`passage_${index}`, item])),
        page_context: strings.slice(0, 40).map((item) => item.text),
      },
      proseQuestions(passages),
    );
    if (!answers) continue;
    batch.forEach(({ index }, target) => {
      for (const { key, message } of CHECKS) {
        const value = noul(answers, `${key}_${target}`);
        results[index].readings[`prose_${key}`] = value;
        if (value >= PROSE_THRESHOLDS[key])
          results[index].issues.push({
            severity: "warn",
            part: strings[index].role,
            message,
            source: jevSource(`prose_${key}`, value),
          });
      }
    });
  }
}
