import type { FoundComment } from "./comments";
import type { Question } from "./jev";

export function commentState(comment: FoundComment) {
  const state: Record<string, unknown> = {
    file: comment.path,
    language: comment.language,
    comment: comment.text,
    code_before: comment.codeBefore,
    code_after: comment.codeAfter,
  };
  if (comment.trailing) {
    state.code_on_same_line = comment.codeOnLine;
  }
  return state;
}

const COMMENT_SUBJECT = "`comment`";

const CODE = "the code it describes (`code_after`, or `code_on_same_line` for a trailing comment)";

// Include external-reference examples to avoid deleting useful comments about names and test tables.
const UNSEEN_NOTE =
  "A comment that says what the code shown cannot tell a reader is worth keeping: the value or meaning of a name defined elsewhere, what escaped or encoded values hold, or which cases the rows of a table cover.";

export function commentQuestions(): Record<string, Question> {
  return {
    sounds_human: {
      type: "noul",
      instructions: `Does ${COMMENT_SUBJECT} read as if a software engineer wrote it by hand?`,
      criteria: {
        true: "Plain and specific, the way an engineer leaves a note for the next reader",
        false:
          "Reads like an AI assistant: 'This ensures...', 'Here we...', 'Note that...', emphatic IMPORTANT or CRITICAL, polished filler, or explaining trivial syntax",
      },
    },
    kind: {
      type: "choice",
      instructions: `What does ${COMMENT_SUBJECT} mainly tell the reader?`,
      criteria: {
        why: {
          what: "The reason behind the code: intent, a constraint, a gotcha, a trade-off, or what would break otherwise",
          examples: [
            "// Safari drops the cookie on redirects, so set it again here",
            "# retry once: the API 502s during deploys",
          ],
        },
        what: {
          what: "What the code does, which the code already shows",
          examples: ["// loop over the users", "# set the timeout to 30 seconds", "// Initialize the state"],
        },
        history: {
          what: "The edit being made or the code's past: now, previously, changed to, added, instead of the old",
          examples: [
            "// Now uses the new parser instead of regex",
            "# Updated to handle nulls",
            "// Added for the new flow",
          ],
        },
        docs: {
          what: "API documentation for a function, class, or field: what it takes and returns and how to use it",
          examples: ["/** Returns the user's display name, or null if they have none. */"],
        },
        label: {
          what: "A section heading, TODO, link, or other marker",
          examples: ["// --- helpers ---", "// TODO: remove after migration", "// See RFC 7231"],
        },
        commented_out_code: { what: "Code that has been commented out" },
      },
    },
    restates_code: {
      type: "noul",
      instructions: `Could a competent reader get everything in ${COMMENT_SUBJECT} just by reading ${CODE}?`,
    },
    narrates_change: {
      type: "noul",
      instructions: `Does ${COMMENT_SUBJECT} describe the edit being made or how the code used to be ('now uses', 'changed to', 'added', 'instead of the old', 'fix for', 'new'), rather than the code as it stands?`,
    },
    worth_keeping: {
      type: "noul",
      instructions: {
        question: `Would a future maintainer be worse off if ${COMMENT_SUBJECT} were deleted?`,
        note: UNSEEN_NOTE,
      },
    },
    contradicts_code: {
      type: "noul",
      instructions: `Does ${COMMENT_SUBJECT} say something that ${CODE} clearly contradicts?`,
      criteria: {
        true: "The code visibly does something different from what the comment says",
        false:
          "The code agrees with the comment, or simply does not show enough to check it. Missing context is not a contradiction.",
      },
    },
    length: {
      type: "choice",
      instructions: `Is ${COMMENT_SUBJECT} the right length for what it needs to say?`,
      criteria: {
        too_short: "Too terse to be understood without guessing",
        right: "About right",
        too_long: "Longer than needed: could say the same in fewer words or lines",
      },
    },
    action: {
      type: "choice",
      instructions: `What should the author do with ${COMMENT_SUBJECT}?`,
      criteria: {
        keep: "Keep it as it is",
        shorten: "Keep the point but cut it down",
        rewrite_as_why: "Rewrite it to explain why the code is this way instead of what it does",
        delete: "Delete it: it restates the code, narrates the edit, or adds nothing",
      },
    },
  };
}
export { accuracyQuestions, accuracyState, styleQuestions, styleState, trimDiff } from "./commit-questions";
