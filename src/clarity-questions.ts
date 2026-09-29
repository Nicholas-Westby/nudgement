import type { CodeUnit } from "./code";
import type { Question } from "./jev";

const READING_GUIDANCE =
  "Read the target in the context of file_context, including existing comments, named constants and callers. " +
  "Judge the maintained code, not deliberately obscure sample code inside strings or test fixtures. " +
  "Do not require comments on every function or a comment quota. Clear names and straightforward logic can be enough. " +
  "A short helper with a vague name can still need a comment explaining what its output is for. " +
  "Test inputs, expected outputs and a clearly named tuning limit do not need arbitrary justifications for their exact values. " +
  "A comment that merely repeats the operations does not explain a hidden contract or rationale. " +
  "Do not invent requirements or demand an explanation of ordinary language syntax.";

/** Each question names a target so a batch still produces findings at specific source lines. */
export function clarityQuestions(units: CodeUnit[]): Record<string, Question> {
  return Object.fromEntries(
    units.flatMap((unit, index) => [
      [
        `explanation_${index}`,
        {
          type: "noul",
          instructions: {
            question:
              `Does target ${index} (${unit.name}) lack an explanation a maintainer needs to understand its purpose, contract or non-obvious logic? ` +
              "Look for terse helpers with an unclear role (including slice/map/join chains with an unexplained output contract), dense transformations, parsing rules, sentinel handling, concurrency invariants, compatibility workarounds and surprising boundary behavior. " +
              "Would a short explanation of the intent, format or reason materially help someone changing this code safely?",
            guidance: READING_GUIDANCE,
          },
        },
      ],
      [
        `magic_${index}`,
        {
          type: "noul",
          instructions: {
            question:
              `Does target ${index} (${unit.name}) use a literal whose meaning or reason is hidden? ` +
              "Include unexplained numeric thresholds, units of measurement, bit masks, control characters, protocol strings, command format strings and opaque regular expressions or capture groups. " +
              "A meaningful name or nearby explanation can make a literal clear. Naming a value VALUE or a regex PATTERN does not explain it. " +
              "Ordinary zero/one indexing, empty strings, obvious separators and self-explanatory data are not magic values.",
            guidance: READING_GUIDANCE,
          },
        },
      ],
    ]),
  );
}
