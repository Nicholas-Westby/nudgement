import type { CopyString } from "./copy-extract";
import type { Question } from "./jev";

const GUIDANCE =
  "Judge usefulness for the audience in app, not whether a human or AI wrote it. " +
  "Use the surrounding page for context. Do not flag ordinary questions, concise instructions, " +
  "specific comparisons or a metaphor that explains a concrete behavior. " +
  "A short heading can name its section without explaining the whole product.";

/** Question suffixes match the explicitly named passages in reviewProse's request state. */
export function proseQuestions(passages: CopyString[]): Record<string, Question> {
  return Object.fromEntries(
    passages.flatMap((_, index) => [
      [
        `setup_${index}`,
        {
          type: "noul",
          instructions: {
            question: `Does passages.passage_${index} use a staged rhetorical setup instead of giving useful information directly? Look for a string of obvious statements followed by a dramatic question, or an empty 'not X, but Y' contrast. Flag the empty setup, not all questions or contrasts.`,
            guidance: GUIDANCE,
          },
        },
      ],
      [
        `vague_${index}`,
        {
          type: "noul",
          instructions: {
            question: `Does passages.passage_${index} contain a vague promise or a strained mental metaphor in place of a specific capability? Flag abstract language about thoughts holding up, elevating ideas or unlocking potential when the reader must guess what is actually checked or changed. In a comparison, assess each side: a concrete claim about the first tool does not explain an abstract claim about the second. Conventional terms such as code review and model judgement are fine when they name the subject; ordinary headings and specific behavior descriptions are fine.`,
            guidance: GUIDANCE,
          },
        },
      ],
    ]),
  );
}
