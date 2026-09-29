import { TYPE_OPTIONS } from "./commit-questions";
import type { Question } from "./jev";
import type { ParsedMessage } from "./message";

// Bound the diff by characters so large commits leave room for questions.
const DIFF_BUDGET = 60_000;

const FILE_BUDGET = 12_000;

export function trimDiff(diffText: string): { text: string; truncated: string[] } {
  const truncated: string[] = [];
  const files = diffText.split(/(?=^diff --git )/m);
  let text = files
    .map((file) => {
      if (file.length <= FILE_BUDGET) return file;
      truncated.push(/^diff --git a\/(\S+)/.exec(file)?.[1] ?? "?");
      return `${file.slice(0, FILE_BUDGET)}\n[... rest of this file's diff cut for length ...]\n`;
    })
    .join("");
  if (text.length > DIFF_BUDGET) {
    text = `${text.slice(0, DIFF_BUDGET)}\n[... rest of the diff cut for length ...]\n`;
    truncated.push("(whole diff)");
  }
  return { text, truncated };
}

export function accuracyState(
  parsed: ParsedMessage,
  files: { path: string; added: number; removed: number }[],
  diff: string,
) {
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
      instructions:
        "Does `commit_message.subject` name the most important change in `diff`, rather than a side detail?",
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
      instructions:
        "Does `commit_message` claim anything that `diff` does not show, such as a feature, test, or fix that is not there?",
    },
    omits_major_change: {
      type: "noul",
      instructions: "Does `diff` contain a significant change that `commit_message` does not mention at all?",
    },
    lists_files: {
      type: "noul",
      instructions:
        "Does `commit_message` mechanically list files, functions, or edits one by one instead of summarizing the change?",
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
    parts[`bullet_${index + 1}`] =
      `Bullet ${index + 1} ("${bullet.slice(0, 60)}") is inaccurate, redundant, or unnecessary`;
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
