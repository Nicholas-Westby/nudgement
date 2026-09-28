/**
 * Every question sent to Jev lives here, so wording changes are easy to find
 * and diff. Following TypeSafe's advice, each question judges one narrow
 * thing, names the field of the state it is about, and code combines them.
 *
 * Human-ness questions see only the message: a diff in the state would pull
 * their answers toward "is this accurate" instead of "does this sound human".
 * Accuracy questions see the message and the diff together.
 */

import type { Question } from "./jev";
import type { ParsedMessage } from "./message";
import type { FoundComment } from "./comments";

const TYPE_OPTIONS: Record<string, string> = {
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
      instructions: "Is `commit_message` longer than it needs to be, so that it could be cut to half its length without losing anything a reviewer needs?",
    },
    subject_imperative: {
      type: "noul",
      instructions: "Is `parts.subject` written in the imperative mood, like a command ('add retry to upload', 'fix crash on empty list')?",
      criteria: {
        true: "Starts with a bare verb such as add, fix, remove, rename, handle, keep, stop",
        false: "Past tense (added, fixed), third person (adds, fixes), a gerund (adding), or a noun phrase with no verb",
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
      instructions: "Do the `parts.bullets` mostly repeat what `parts.subject` already says, adding little new information?",
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

// About 15k tokens of diff. Enough for most commits; bigger ones are cut per file.
const DIFF_BUDGET = 60_000;
const FILE_BUDGET = 12_000;

export function trimDiff(diffText: string): { text: string; truncated: string[] } {
  const truncated: string[] = [];
  const files = diffText.split(/(?=^diff --git )/m);
  let text = files
    .map((file) => {
      if (file.length <= FILE_BUDGET) return file;
      truncated.push(/^diff --git a\/(\S+)/.exec(file)?.[1] ?? "?");
      return file.slice(0, FILE_BUDGET) + "\n[... rest of this file's diff cut for length ...]\n";
    })
    .join("");
  if (text.length > DIFF_BUDGET) {
    text = text.slice(0, DIFF_BUDGET) + "\n[... rest of the diff cut for length ...]\n";
    truncated.push("(whole diff)");
  }
  return { text, truncated };
}

export function accuracyState(parsed: ParsedMessage, files: { path: string; added: number; removed: number }[], diff: string) {
  return {
    commit_message: {
      type: parsed.type ?? null,
      scope: parsed.scope ?? null,
      subject: parsed.subject ?? parsed.header,
      bullets: parsed.bullets,
      other_body_lines: parsed.prose,
    },
    changed_files: files.map((file) => ({ path: file.path, lines_added: file.added, lines_removed: file.removed })),
    diff,
  };
}

export function accuracyQuestions(parsed: ParsedMessage): Record<string, Question> {
  const bulletCount = parsed.bullets.length;
  const questions: Record<string, Question> = {
    type_fits: {
      type: "noul",
      instructions: {
        question: "Is `commit_message.type` the right Conventional Commits type for the change in `diff`?",
        types: TYPE_OPTIONS,
      },
    },
    best_type: {
      type: "choice",
      instructions: "Which Conventional Commits type best describes the change in `diff`?",
      criteria: TYPE_OPTIONS,
    },
    subject_accurate: {
      type: "noul",
      instructions: "Does `commit_message.subject` correctly describe what `diff` does?",
    },
    subject_main_change: {
      type: "noul",
      instructions: "Does `commit_message.subject` name the most important change in `diff`, rather than a side detail?",
    },
    subject_specificity: {
      type: "score",
      instructions: "How specific is `commit_message.subject` about what changed in `diff`?",
      criteria: [
        "Vague: could describe almost any commit ('update code', 'fix issues')",
        "General: names the area but not what changed in it ('update auth')",
        "Specific: says what changed in which area ('add retry to token refresh')",
        "Precise: says exactly what changed and, where it matters, the effect ('retry token refresh once on 401')",
      ],
    },
    claims_unsupported: {
      type: "noul",
      instructions: "Does `commit_message` claim anything that `diff` does not show, such as a feature, test, or fix that is not there?",
    },
    omits_major_change: {
      type: "noul",
      instructions: "Does `diff` contain a significant change that `commit_message` does not mention at all?",
    },
    lists_files: {
      type: "noul",
      instructions: "Does `commit_message` mechanically list files, functions, or edits one by one instead of summarizing the change?",
    },
    why_given: {
      type: "choice",
      instructions: "Does `commit_message` explain why the change was made?",
      criteria: {
        explains_why: "Gives the reason, the problem solved, or the constraint behind the change",
        why_obvious: "Gives no reason, but the reason is obvious from the subject so none is needed",
        why_missing: "Gives no reason, and a reviewer would want one",
      },
    },
    should_split: {
      type: "noul",
      instructions: "Does `diff` contain several unrelated changes that belong in separate commits?",
    },
    bullet_count: {
      type: "choice",
      instructions: {
        question: `\`commit_message\` has ${bulletCount} bullet point${bulletCount === 1 ? "" : "s"}. How should that change, given how much \`diff\` does?`,
        rule: "The house style allows zero to three short bullets. Bullets are for things a reviewer needs that the subject cannot hold.",
      },
      criteria: {
        fewer: "Fewer bullets: some repeat the subject, restate the diff, or say nothing a reviewer needs",
        right: "The number of bullets is right",
        more: "More bullets: an important part of the change or its reason is missing from the message",
      },
    },
    overall: {
      type: "score",
      instructions: "How good is `commit_message` as a commit message for `diff`?",
      criteria: [
        "Poor: wrong, misleading, or says nothing useful",
        "Needs work: roughly right but vague, padded, or missing something important",
        "Good: accurate, specific, and concise",
        "Excellent: exactly what a careful senior engineer would write",
      ],
    },
  };

  if (parsed.scope) {
    questions.scope_fits = {
      type: "noul",
      instructions: "Does `commit_message.scope` name the area of the codebase that `diff` mainly changes?",
    };
    questions.scope_assessment = {
      type: "choice",
      instructions: "How well does `commit_message.scope` fit the files and code changed in `diff`?",
      criteria: {
        fits: "Names the area the change is about, at a useful level",
        too_broad: "Names a much larger area than the change touches",
        too_narrow: "Names one file or detail when the change spans a wider area",
        wrong_area: "Names an area the change is not about",
      },
    };
  } else {
    questions.scope_needed = {
      type: "noul",
      instructions:
        "`commit_message` has no scope. Is the change in `diff` confined to one clear area of the codebase that a short scope word, such as api, auth, or ui, would name?",
    };
  }

  parsed.bullets.forEach((_, index) => {
    questions[`bullet_${index + 1}_accurate`] = {
      type: "noul",
      instructions: `Is every change that \`commit_message.bullets[${index}]\` says was made actually in \`diff\`?`,
      criteria: {
        true: "The changes it describes are in the diff, or it gives a reason, background, or effect rather than describing a change",
        false: "It describes a change the diff does not contain, or describes it wrongly",
      },
    };
    questions[`bullet_${index + 1}_adds_info`] = {
      type: "noul",
      instructions: `Does \`commit_message.bullets[${index}]\` tell a reviewer something important that \`commit_message.subject\` does not already say?`,
    };
  });

  const parts: Record<string, string> = {
    type: "The type is the wrong kind of change",
    scope: parsed.scope ? "The scope does not fit the area changed" : "The message needs a scope",
    subject: "The subject is vague, inaccurate, or poorly worded",
  };
  parsed.bullets.forEach((bullet, index) => {
    parts[`bullet_${index + 1}`] = `Bullet ${index + 1} ("${bullet.slice(0, 60)}") is inaccurate, redundant, or unnecessary`;
  });
  if (!bulletCount) parts.body = "The message needs a short body to explain the change";
  parts.nothing = "Nothing stands out: the message is already good";
  questions.weakest_part = {
    type: "choice",
    instructions: "Which part of `commit_message` most needs improving, given `diff`?",
    criteria: parts,
  };

  return questions;
}

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

// Comments on escapes, test tables and names defined in other files were marked for deletion.
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
          examples: ["// Safari drops the cookie on redirects, so set it again here", "# retry once: the API 502s during deploys"],
        },
        what: {
          what: "What the code does, which the code already shows",
          examples: ["// loop over the users", "# set the timeout to 30 seconds", "// Initialize the state"],
        },
        history: {
          what: "The edit being made or the code's past: now, previously, changed to, added, instead of the old",
          examples: ["// Now uses the new parser instead of regex", "# Updated to handle nulls", "// Added for the new flow"],
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
      instructions: { question: `Would a future maintainer be worse off if ${COMMENT_SUBJECT} were deleted?`, note: UNSEEN_NOTE },
    },
    contradicts_code: {
      type: "noul",
      instructions: `Does ${COMMENT_SUBJECT} say something that ${CODE} clearly contradicts?`,
      criteria: {
        true: "The code visibly does something different from what the comment says",
        false: "The code agrees with the comment, or simply does not show enough to check it. Missing context is not a contradiction.",
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
