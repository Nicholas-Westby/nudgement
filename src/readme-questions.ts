/**
 * The questions Jev is asked about a README: one request about the whole
 * document and one per section. Each question judges one thing, so the
 * answers can be weighed separately in readme-evaluate.ts.
 */

import type { Question } from "./jev";
import { REWRITE_OPTIONS } from "./code-questions";
import { clip } from "./run";
import type { MdAnalysis, MdSection } from "./markdown";

const README_BUDGET = 100_000;

export interface ProjectContext {
  name: string;
  description?: string;
  /** Top-level files and folders, so Jev can tell what kind of project it is. */
  files: string[];
  scripts?: string[];
}

export const HUMAN_CRITERIA = {
  true: "Plain, specific wording a developer would write for the next person: says what things are and how to use them",
  false:
    "Reads like an AI assistant or a template: polished filler (comprehensive, robust, seamless, powerful, leverage), balanced over-explaining, sales language, or generic statements that fit any project",
};

export function readmeState(md: MdAnalysis, project: ProjectContext) {
  const text = md.lines.join("\n");
  return {
    readme: clip(text, README_BUDGET, "\n[... rest cut for length ...]"),
    facts: {
      words: md.facts.words,
      lines: md.facts.lines,
      headings: md.facts.headings,
      code_blocks: md.facts.codeBlocks,
      list_items: md.facts.listItems,
      tables: md.facts.tables,
      badges: md.facts.badges,
      emoji: md.facts.emoji,
      has_table_of_contents: md.facts.hasToc,
    },
    project,
  };
}

export function readmeQuestions(): Record<string, Question> {
  return {
    sounds_human: {
      type: "noul",
      instructions: "Does `readme` read as if a developer wrote it by hand for the people who will use this project?",
      criteria: HUMAN_CRITERIA,
    },
    ai_filler: {
      type: "noul",
      instructions:
        "Does `readme` use wording typical of AI-written text, such as comprehensive, robust, seamless, powerful, leverage, effortless, 'Whether you're a beginner or an expert', or 'In today's fast-paced world'?",
    },
    marketing: {
      type: "noul",
      instructions: "Does `readme` sell rather than inform, with superlatives, benefit claims, or hype such as 'blazing fast' or 'the ultimate'?",
    },
    says_what_it_is: {
      type: "noul",
      instructions: "Does `readme` say plainly, near the top, what the project is and what it does?",
    },
    shows_usage: {
      type: "noul",
      instructions: "Does `readme` show how to install, run, or use the project, with concrete commands or examples?",
    },
    rewrite_length: {
      type: "choice",
      instructions: {
        question: "If a skilled writer rewrote `readme` to tell a newcomer everything they need just as clearly, how long would the rewrite be?",
        note: "Keep every command, option, and fact a reader needs. Cut only padding, repetition, and decoration.",
      },
      criteria: REWRITE_OPTIONS,
    },
    padding: {
      type: "noul",
      instructions:
        "Does `readme` spend words a reader does not need, such as restating the obvious, explaining general tools like git or npm, or long introductions before getting to the point?",
    },
    over_structured: {
      type: "noul",
      instructions:
        "Does `readme` use more headings, bullet lists, tables, badges, or emoji than its content needs, such as a heading for every two sentences or bullets for what one sentence would say?",
    },
    boilerplate: {
      type: "noul",
      instructions:
        "Does `readme` contain generic sections that could appear in any project, such as Contributing, Support, Acknowledgements, or Roadmap with nothing specific to this project, or placeholder text?",
    },
    redundancy: {
      type: "noul",
      instructions: "Does `readme` say the same thing in more than one place, such as an introduction, an overview, and a features list that all repeat each other?",
    },
    disorganized: {
      type: "noul",
      instructions: "Is `readme` hard to find things in, with important information buried, sections in an odd order, or headings that do not match what is under them?",
    },
    too_terse: {
      type: "noul",
      instructions: "Is `readme` too thin to help a newcomer, leaving out what the project is, how to run it, or what it needs?",
    },
    overall: {
      type: "score",
      instructions: "How good is `readme` as the README for the project in `project`?",
      criteria: [
        "Poor: a newcomer would struggle, or it is mostly filler",
        "Needs work: the essentials are there but it is padded, generic, or badly organized",
        "Good: clear, specific, and to the point",
        "Excellent: exactly what a careful maintainer would write",
      ],
    },
    biggest_problem: {
      type: "choice",
      instructions: "What most needs fixing in `readme`?",
      criteria: {
        nothing: "Nothing notable: it is clear, specific, and tight",
        ai_voice: "It reads as AI-written",
        marketing: "It sells instead of informing",
        padding: "Too many words for what it says",
        over_structured: "Too many headings, lists, badges, or emoji",
        boilerplate: "Generic sections with nothing specific",
        redundancy: "The same thing said more than once",
        missing_what_it_is: "It never plainly says what the project is",
        missing_usage: "It never shows how to use the project",
        disorganized: "Hard to find things in",
        too_terse: "Too thin to help a newcomer",
      },
    },
  };
}

export function sectionState(md: MdAnalysis, section: MdSection, project: ProjectContext) {
  return {
    project: project.name,
    readme_outline: md.headings.map((heading) => `${"#".repeat(heading.level)} ${heading.text}`),
    section: { heading: section.heading, text: section.text },
  };
}

export function sectionQuestions(): Record<string, Question> {
  return {
    sounds_human: {
      type: "noul",
      instructions: "Does `section.text` read as if a developer wrote it by hand?",
      criteria: HUMAN_CRITERIA,
    },
    filler: {
      type: "noul",
      instructions: "Does `section.text` use filler, sales language, or wording typical of AI-written text?",
    },
    rewrite_length: {
      type: "choice",
      instructions: {
        question: "If a skilled writer rewrote `section.text` to say everything a reader needs just as clearly, how long would the rewrite be?",
        note: "Keep every command, option, and fact. Cut only padding, repetition, and decoration.",
      },
      criteria: REWRITE_OPTIONS,
    },
    earns_its_place: {
      type: "noul",
      instructions: "Would a reader of this README miss `section` if it were deleted?",
    },
    matches_heading: {
      type: "noul",
      instructions: "Does `section.text` deliver what `section.heading` promises?",
    },
    over_structured: {
      type: "noul",
      instructions: "Does `section.text` use more sub-headings, bullets, tables, or emoji than its content needs?",
    },
    action: {
      type: "choice",
      instructions: "What should a careful editor do with `section`?",
      criteria: {
        keep: "Keep it as it is",
        trim: "Keep it but cut it down",
        rewrite_plainly: "Rewrite it in plain, specific words",
        delete: "Delete it: a reader would not miss it",
        merge: "Merge it into another section",
      },
    },
  };
}

// Required content is asked about in a request of its own. In the same request
// as the other questions, the list swayed them: a README that passed on its own
// was called bloated once three requirements were added.
export function requiredState(md: MdAnalysis, requirements: string[]) {
  const text = md.lines.join("\n");
  return {
    readme: clip(text, README_BUDGET, "\n[... rest cut for length ...]"),
    required_content: requirements,
  };
}

export function requiredQuestions(requirements: string[]): Record<string, Question> {
  return Object.fromEntries(
    requirements.map((_, index): [string, Question] => [
      `covers_${index + 1}`,
      {
        type: "noul",
        instructions: `Does \`readme\` cover \`required_content[${index}]\`?`,
        criteria: {
          true: "It gives the substance asked for, specific to this project",
          false: "It is missing, or only mentioned in passing without the substance asked for",
        },
      },
    ])
  );
}
