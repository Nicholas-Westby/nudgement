import type { Platform } from "./copy-evaluate";
import type { CopyRole } from "./copy-extract";
import { BUTTON_STATE, CASED_ROLES, MAC_STANDARD_ACTION, TITLE_STYLE_ROLES } from "./copy-rules";
import type { Question } from "./jev";

export function stringQuestions(role: CopyRole, text: string, platform: Platform = "web"): Record<string, Question> {
  const mac = platform === "mac";
  const questions: Record<string, Question> = {
    plain: {
      type: "noul",
      instructions:
        "Does `text` use plain words the readers described in `app` would use, with no technical jargon such as status codes, 'payload', 'invalid input', or internal names?",
    },
    passive: {
      type: "noul",
      instructions: {
        question: "Is `text` written in the passive voice, where an active version would be clearer?",
        examples_of_yes: ["Your password has been reset.", "The file could not be uploaded.", "Mistakes were made."],
        examples_of_no: [
          "The upload didn't finish.",
          "We couldn't save your changes.",
          "The shop closed early.",
          "Deliveries stop at the cut-off time.",
          // Passive status labels are often idiomatic, especially when the actor is irrelevant.
          "Added by Anna",
          "Removed from the list",
          "Shared with nobody yet",
        ],
      },
    },
    marketing: {
      type: "noul",
      instructions:
        "Does `text` sound like marketing or hype, with exclamation, superlatives, or words like awesome, amazing, or seamless?",
    },
  };
  // Short strings read as wordy to Jev almost regardless, so only longer ones are asked.
  if (text.split(/\s+/).length >= 8)
    questions.wordy = { type: "noul", instructions: "Could `text` say the same thing in noticeably fewer words?" };
  // Apply platform capitalization with exact rules instead of model probabilities.
  if (CASED_ROLES.has(role) && !(mac && TITLE_STYLE_ROLES.has(role))) {
    questions.sentence_case = {
      type: "noul",
      instructions:
        "Is `text` in sentence case, with a capital only on the first word and on proper names such as product names, rather than Title Case or ALL CAPS?",
    };
  }
  if (role === "button" && !mac) {
    questions.action_clear = {
      type: "noul",
      instructions:
        "Does `text` say exactly what will happen when it is pressed, such as 'Save changes' or 'Send invite', rather than 'Submit', 'OK', or 'Click here'?",
    };
  }
  if (role === "button" && mac && !MAC_STANDARD_ACTION.test(text.trim()) && !BUTTON_STATE.test(text.trim())) {
    questions.action_clear = {
      type: "noul",
      instructions:
        "`text` is a button or menu item in a Mac app. Does it say what will happen when it is chosen, such as 'Add to Favorites' or 'Join', rather than 'Submit' or 'Click here'? A short verb is clear where its sheet, menu or toolbar gives the context, and a trailing … correctly means it opens a dialog first.",
    };
  }
  if (role === "link") {
    questions.link_clear = {
      type: "noul",
      instructions:
        "As the text of a link, does `text` make clear where it leads or what it does? Descriptive text such as an item's name or its status is fine; 'Click here' or 'More' is not.",
    };
  }
  if (role === "error") {
    questions.error_helpful = {
      type: "noul",
      instructions: "Does `text` say what went wrong and what the reader can do about it, in words they understand?",
    };
    questions.blames = { type: "noul", instructions: "Does `text` blame or scold the reader?" };
    questions.apologizes = {
      type: "noul",
      instructions: "Does `text` apologize, such as 'Sorry', 'Oops', or 'Unfortunately'?",
    };
  }
  return questions;
}
