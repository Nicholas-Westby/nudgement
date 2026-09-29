import type { Question } from "./jev";

export const HISTORY_QUESTIONS: Record<string, Question> = {
  focused_steps: {
    type: "noul",
    instructions:
      "Does `history` read as a sequence of focused steps, each commit doing one thing a reviewer can follow?",
  },
  logical_order: {
    type: "noul",
    instructions:
      "Is the order of `history` logical, with foundations such as data models and setup before the features that build on them?",
  },
  consistent_style: {
    type: "noul",
    instructions: "Do the commit subjects in `history` follow one consistent style?",
  },
  overall: {
    type: "score",
    instructions: "How good is `history` as a commit history for a reviewer reading it commit by commit?",
    criteria: [
      "Poor: a few giant or chaotic commits, or full of noise",
      "Needs work: mostly sensible, but with mixed commits, fixups, or a confusing order",
      "Good: focused commits in a sensible order",
      "Excellent: reads like a clear story of how the project was built",
    ],
  },
};

export const COMMIT_QUESTIONS: Record<string, Question> = {
  folds_into_earlier: {
    type: "noul",
    instructions: {
      question:
        "Does `commit` only correct a slip in a recent earlier commit of `history`, so that squashing it into that commit would lose nothing a reviewer needs?",
      note: "Judge by what the diff changes and what the message says was wrong. A bug found later, through use, a new test, a benchmark or a report, is a separate bug and keeps its own commit, even when an earlier commit in `history` introduced it.",
      examples_of_yes: [
        "it fixes a typo, a missing import or file, or a call site the earlier commit missed",
        "it fixes a type, lint or build error, or a failing test, that the earlier commit left behind",
        "it adds the docs line for a flag or option the earlier commit added",
        "it removes debug output or a stray change the earlier commit let in",
      ],
      examples_of_no: [
        "it fixes a bug found later and says what went wrong",
        "it changes a threshold, rule, wording or design after measuring or learning something new",
        "it adds behaviour or builds on earlier work",
      ],
    },
  },
  mixes_unrelated: {
    type: "noul",
    instructions: {
      question:
        "Does `commit` bundle two or more changes that have nothing to do with each other and would each make sense as a commit of its own?",
      examples_of_yes: [
        "a feature plus an unrelated dependency bump",
        "a fix in one area plus an unrelated fix in another",
      ],
      examples_of_no: [
        "a feature with its tests and docs",
        "a fix with the test that proves it",
        "one rename across many files",
      ],
    },
  },
};
