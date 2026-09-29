import type { Question } from "./jev";
import type { ParsedMessage } from "./message";

export const TYPE_OPTIONS: Record<string, string> = {
  feat: "Adds a new feature or capability that users or callers can use",
  fix: "Fixes a bug: behaviour that was wrong now works as intended",
  docs: "Changes documentation for human readers only, such as README files, guides, or doc comments. Prompts, skills, and instruction files that a program or AI agent follows are not docs: changing them changes behaviour",
  refactor: "Restructures code without changing what it does",
  test: "Adds or corrects tests only",
  chore: "Tooling, configuration, dependencies, scripts, or housekeeping that does not change the product",
  perf: "Makes existing behaviour faster or use fewer resources",
  build: "Changes the build system or packaging",
  ci: "Changes continuous integration configuration",
  style: "Formatting or whitespace only, with no change in meaning",
  revert: "Undoes an earlier commit",
};

const HUMAN_CRITERIA = {
  true: "Plain, terse, specific wording a developer would type: names the actual thing that changed, no filler, no sales language",
  false:
    "Reads like an AI assistant or a template: polished filler words (comprehensive, robust, seamlessly, enhance, ensure, leverage), vague benefit claims, restating the obvious, listing every file touched, or unnaturally balanced and complete-sounding phrasing",
};

export function styleState(parsed: ParsedMessage) {
  return {
    commit_message: parsed.judged,
    parts: {
      type: parsed.type ?? null,
      scope: parsed.scope ?? null,
      subject: parsed.subject ?? parsed.header,
      bullets: parsed.bullets,
    },
  };
}

export function styleQuestions(parsed: ParsedMessage): Record<string, Question> {
  const questions: Record<string, Question> = {
    sounds_human: {
      type: "noul",
      instructions: "Does `commit_message` read as if a software engineer wrote it by hand?",
      criteria: HUMAN_CRITERIA,
    },
    ai_filler: {
      type: "noul",
      instructions:
        "Does `commit_message` use filler words typical of AI-written text, such as comprehensive, robust, seamless, leverage, enhance, streamline, utilize, ensure, various, or improved handling?",
    },
    vague_benefits: {
      type: "noul",
      instructions:
        "Does `commit_message` claim benefits without saying concretely what changed, such as 'improve performance', 'better user experience', 'for maintainability', or 'more reliable'?",
    },
    over_explained: {
      type: "noul",
      instructions:
        "Is `commit_message` longer than it needs to be, so that it could be cut to half its length without losing anything a reviewer needs?",
    },
    subject_imperative: {
      type: "noul",
      instructions:
        "Is `parts.subject` written in the imperative mood, like a command ('add retry to upload', 'fix crash on empty list')?",
      criteria: {
        true: "Starts with a bare verb such as add, fix, remove, rename, handle, keep, stop",
        false:
          "Past tense (added, fixed), third person (adds, fixes), a gerund (adding), or a noun phrase with no verb",
      },
    },
    subject_generic: {
      type: "noul",
      instructions:
        "Is `parts.subject` so generic it could describe almost any commit, such as 'update code', 'fix bug', 'misc changes', 'address feedback', or 'improve things'?",
    },
    tone: {
      type: "choice",
      instructions: "Which best describes the tone of `commit_message`?",
      criteria: {
        terse_developer: "Short and matter-of-fact, the way an engineer writes a quick, specific commit",
        plain_professional: "Clear, complete sentences, neutral, still specific",
        ai_assistant: "Polished, thorough, balanced phrasing that explains and justifies like a chatbot",
        marketing: "Promotional: talks up benefits, impact, or quality",
      },
    },
  };
  if (parsed.bullets.length) {
    questions.bullets_repeat_subject = {
      type: "noul",
      instructions:
        "Do the `parts.bullets` mostly repeat what `parts.subject` already says, adding little new information?",
    };
  }
  parsed.bullets.forEach((_, index) => {
    questions[`bullet_${index + 1}_human`] = {
      type: "noul",
      instructions: `Does \`parts.bullets[${index}]\` read as if a software engineer wrote it by hand?`,
      criteria: HUMAN_CRITERIA,
    };
  });
  return questions;
}
export { accuracyQuestions, accuracyState, trimDiff } from "./accuracy-questions";
