/**
 * The questions Jev is asked about a design spec and an implementation plan.
 * Each asks one narrow thing, so a "yes" means one thing only. The standard is
 * the superpowers brainstorming and writing-plans skills: a spec says why and
 * what, concretely enough that two engineers build the same thing; a plan's
 * task can be carried out by someone with no context, test first.
 */

import type { Question } from "./jev";
import { HUMAN_CRITERIA } from "./readme-questions";

export const DESIGN_QUESTIONS: Record<string, Question> = {
  sounds_human: {
    type: "noul",
    instructions: "Does `spec` read as if a developer wrote it by hand for the people who will build it?",
    criteria: HUMAN_CRITERIA,
  },
  ai_filler: {
    type: "noul",
    instructions:
      "Does `spec` use wording typical of AI-written text, such as comprehensive, robust, seamless, powerful, leverage, effortless, 'Whether you're a beginner or an expert', or 'In today's fast-paced world'?",
  },
  states_intent: {
    type: "noul",
    instructions: "Does `spec` say what problem it solves, or what the people it is for want to achieve, and not only what will be built?",
  },
  states_out_of_scope: {
    type: "noul",
    instructions: "Does `spec` say what is out of scope: things it deliberately will not do or build?",
  },
};

export const SECTION_QUESTIONS: Record<string, Question> = {
  concrete: {
    type: "noul",
    instructions: {
      question: "Does `section.text` say concretely what to build or what holds true, in terms a person could build and test against?",
      note: "A section of background, reasons or assumptions counts as concrete when it states specific facts.",
    },
    criteria: {
      true: "It names behaviour, values, limits, messages, file or type names, or measured facts",
      false: "It states goals or qualities (fast, intuitive, robust, handles errors gracefully) without saying what exactly happens",
    },
  },
  open_decision: {
    type: "noul",
    instructions: {
      question: "Does `section.text` leave a decision open without saying so?",
      note: "A choice made with a stated fallback ('if X fails, do Y') is decided. So is an option listed as rejected.",
    },
    criteria: {
      true: "It offers alternatives ('X or Y', 'maybe', 'could', 'we might') and never picks one, or puts off a choice without saying who decides",
      false: "Every choice it raises is made",
    },
  },
  untestable: {
    type: "noul",
    instructions: "Does `section.text` state an outcome that a tester could not check as pass or fail, such as 'works well', 'feels smooth', 'is fast' or 'handles errors gracefully'?",
  },
  two_builds: {
    type: "choice",
    instructions: "If two engineers each built what `section.text` describes, without talking to each other, how would their results compare?",
    criteria: {
      same: "The same in everything a user or a test would notice",
      small_differences: "Small differences in details the section rightly leaves open",
      different_behaviour: "Different behaviour, values or failure handling, because the section leaves them unsaid",
      different_things: "Different things altogether: the section says what it wants, not what it is",
    },
  },
};

// Asked of one decision at a time: over a whole section, one bare statement
// among many well-argued ones was enough for a yes.
export const DECISION_QUESTIONS: Record<string, Question> = {
  why: {
    type: "choice",
    instructions: {
      question: "What does `decision` say about why it was chosen?",
      note: "`section` is the text around it; a reason or rejected option in the next item counts.",
    },
    criteria: {
      reason: "It gives a reason for the choice",
      rejected_alternative: "It names an alternative it rules out",
      none_needed: "It gives none and needs none: a detail, a label, a follow-on from another decision, or the obvious default",
      none: "It gives none, though it picks between approaches a reviewer could reasonably question",
    },
  },
};

export const TASK_QUESTIONS: Record<string, Question> = {
  self_contained: {
    type: "noul",
    instructions: "Could a skilled engineer who has never seen this codebase carry out `task` from `task` alone, with `plan_goal` and `global_constraints`, without guessing?",
    criteria: {
      true: "It names the files, the code or the exact behaviour to write, the tests and how to run them; what it uses from other tasks is named exactly",
      false: "The engineer would have to invent details: which files, what the code does, what the tests check, or names from other tasks it does not give",
    },
  },
  several_tasks: {
    type: "noul",
    instructions: "Does `task` bundle several unrelated pieces of work that a reviewer could accept or reject separately, rather than one deliverable with its own test cycle?",
  },
  vague_steps: {
    type: "noul",
    instructions:
      "Does any step of `task` say what to do without saying how, such as 'update the view', 'wire it up', 'add validation' or 'handle errors', leaving the engineer to invent the details?",
  },
};

export const TASK_TEST_QUESTION: Record<string, Question> = {
  test_checks_behaviour: {
    type: "noul",
    instructions: "Would the tests `task` asks for fail if the behaviour this task adds were missing or wrong?",
    criteria: {
      true: "They check the task's actual outcomes, with exact expected values or messages",
      false: "They check something else, only that the code runs, or expect too loosely to catch a wrong result",
    },
  },
};

/**
 * Which of the few tasks picked for a requirement builds it. A choice rather
 * than yes or no: asked "would these tasks implement it", Jev said yes for a
 * task that only tested the feature end to end or mentioned it in passing.
 */
export function coverageQuestions(taskTitles: string[], hasContext: boolean): Record<string, Question> {
  return {
    implemented_by: {
      type: "choice",
      instructions: {
        question: "Which of `tasks` builds what `requirement` asks for?",
        note: "A task that only tests the feature end to end, or only mentions it, does not build it. When the requirement is itself about tests or checks, the task that writes them builds it. A section such as Global Constraints holds rules every task follows, and builds a requirement that is such a rule.",
      },
      criteria: {
        ...Object.fromEntries(taskTitles.map((title, index) => [`task_${index + 1}`, title])),
        none: "None of them builds it",
      },
    },
    does_it: {
      type: "noul",
      instructions: "Does one of `tasks` have a step, code or test that does what `requirement` says?",
      criteria: {
        true: "A step, code block or named test in one task does exactly this, even in other words",
        false: "The tasks only touch the same subject (the same type, file or screen) without doing this",
      },
    },
    ...(hasContext
      ? {
          handled_elsewhere: {
            type: "noul",
            instructions: "Does `plan_context` say that `requirement` is handled outside this plan: left out on purpose, done by another plan, or already built?",
          } satisfies Question,
        }
      : {}),
  };
}
