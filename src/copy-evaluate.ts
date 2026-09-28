/**
 * Judges the user-facing strings in a view: plain words, sentence case, active
 * voice, buttons that say what happens, errors that say what went wrong and
 * how to fix it without apologizing, no hype and no jargon. Code catches the exact cases (ALL CAPS, "Sorry", "Submit",
 * status codes, exclamation marks); Jev judges each string in its own request,
 * with the page's other strings as context. Thresholds are in COPY_THRESHOLDS
 * for tuning against bench/copy.
 *
 * A Swift file is a Mac app, which follows Apple's conventions instead: title
 * style ("Add to Favorites") is right for buttons, menu items and window
 * titles, and a sheet's Cancel, Done or OK is standard, not vague.
 */

import { extractCopy, type CopyRole, type CopyString } from "./copy-extract";
import { noul, type Answers, type Question } from "./jev";
import { jevSource, startRun, type JevStats } from "./run";
import type { Issue } from "./message";

// Benchmarked 2026-09-26 on 184 labelled strings in 20 views (bench/copy).
export const COPY_THRESHOLDS = {
  plain: 0.35,
  sentenceCase: 0.3,
  // Negated active verbs ("didn't load") read up to 0.67 without the examples; with them,
  // passives read 0.74 and up and active sentences 0.67 at most, once 0.73.
  passive: 0.7,
  actionClear: 0.35,
  errorHelpful: 0.2,
  blames: 0.6,
  apologizes: 0.6,
  marketing: 0.6,
  wordy: 0.88,
};

const T = COPY_THRESHOLDS;
const MAX_STRINGS = 120;

export interface CopyOptions {
  tag?: string;
  /** What the app is and who reads it, so Jev judges words for the right audience. */
  app?: string;
  /** Names that keep their capitals, such as product names. */
  properNouns?: string[];
  /** Only strings on these lines (from a commit's diff). */
  touched?: Set<number>;
}

export interface CopyResult {
  text: string;
  role: CopyRole;
  line: number;
  issues: Issue[];
  readings: Record<string, number>;
}

export interface CopyEvaluation {
  kind: "copy";
  runId: string;
  version: string;
  repo?: string;
  ref?: string;
  path: string;
  verdict: "pass" | "fail";
  strings: CopyResult[];
  issues: Issue[];
  jev: JevStats;
}

export type Platform = "web" | "mac";

const DEFAULT_APP: Record<Platform, string> = {
  web: "A web app. Readers are its everyday users, not developers.",
  mac: "A Mac app. Readers are its everyday users, not developers.",
};
const ALWAYS_PROPER = ["I", "QR", "Apple", "iPhone", "Android", "OK", "Mac", "macOS", "Finder", "Safari", "iCloud"];
// Acronyms a reader knows, which are not shouting.
const ACRONYMS = new Set(["URL", "API", "AI", "PDF", "ID", "OK", "QR"]);
const SMALL_WORDS = new Set("a an and as at but by for from if in into of off on or per so than the to up via with".split(" "));
// Apple's title style leaves these lowercase: articles, coordinating conjunctions, prepositions of four letters or fewer.
const ACRONYM = /^\p{Lu}{2,}s?$/u;
const TITLE_STYLE_SMALL = new Set("a an the and but or nor for so yet as at by from in into of off on onto out over per to up upon via with".split(" "));
// Roles whose capitals are checked: sentence case on the web, and on a Mac where title style does not apply.
const CASED_ROLES = new Set(["title", "heading", "button", "link", "label", "option"]);
// Roles where a Mac app uses title style: buttons, menu items, window and section titles.
const TITLE_STYLE_ROLES = new Set(["title", "heading", "button", "link", "option"]);
const VAGUE_ACTION = /^(submit|ok|okay|go|here|continue|send|done|next|yes|no|more|details|link|confirm|save|view|open|show)[.!]?$|^(click here|learn more|read more|more info)\b/i;
// A Mac sheet or alert's own buttons, which the dialog around them explains.
const MAC_STANDARD_ACTION = /^(ok|cancel|done|save|open|send|continue|close|delete|add|show|hide|learn more)…?$/i;
// A button's state while or after it works, such as "Checking…" or Copy turning into "Copied".
const BUTTON_STATE = /^\p{Lu}\p{Ll}+(ed|ing…)$/u;
const APOLOGY = /\b(sorry|oops|whoops|uh[- ]oh|apologi[sz]e|unfortunately)\b/i;
const JARGON = /\b(payload|null|undefined|NaN|invalid input|exception|stack trace|request failed|server error|uuid|json|http|utc|timestamp|template id)\b|\b[45]\d\d\b|\.ics\b|\((int|string|bool|number)\)|\b[a-z]+_[a-z_]+\b/i;
// A company or product left unnamed, when the reader needs to know which one.
// A path or an app's internal file shown to the reader; an extension alone (".quiltbook") is fine.
const FILE_PATH = /(^|[\s"“'(])(~\/|\/(Users|Library|Applications|System|Volumes|private|tmp|var)\/|\.[\w-]+\/)|\b[\w-]+\.(json|plist|sqlite|db|log|txt|md|yaml|yml|xml|csv|swift|ts|js)\b/;

export function stringQuestions(role: CopyRole, text: string, platform: Platform = "web"): Record<string, Question> {
  const mac = platform === "mac";
  const questions: Record<string, Question> = {
    plain: {
      type: "noul",
      instructions: "Does `text` use plain words the readers described in `app` would use, with no technical jargon such as status codes, 'payload', 'invalid input', or internal names?",
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
          // Short status labels and bylines: the passive is the idiom, and the person is named or does not matter.
          "Added by Anna",
          "Removed from the list",
          "Shared with nobody yet",
        ],
      },
    },
    marketing: {
      type: "noul",
      instructions: "Does `text` sound like marketing or hype, with exclamation, superlatives, or words like awesome, amazing, or seamless?",
    },
  };
  // Short strings read as wordy to Jev almost regardless, so only longer ones are asked.
  if (text.split(/\s+/).length >= 8) questions.wordy = { type: "noul", instructions: "Could `text` say the same thing in noticeably fewer words?" };
  // A Mac app's title style is checked in code, which knows Apple's rule.
  if (CASED_ROLES.has(role) && !(mac && TITLE_STYLE_ROLES.has(role))) {
    questions.sentence_case = {
      type: "noul",
      instructions: "Is `text` in sentence case, with a capital only on the first word and on proper names such as product names, rather than Title Case or ALL CAPS?",
    };
  }
  if (role === "button" && !mac) {
    questions.action_clear = {
      type: "noul",
      instructions: "Does `text` say exactly what will happen when it is pressed, such as 'Save changes' or 'Send invite', rather than 'Submit', 'OK', or 'Click here'?",
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
      instructions: "As the text of a link, does `text` make clear where it leads or what it does? Descriptive text such as an item's name or its status is fine; 'Click here' or 'More' is not.",
    };
  }
  if (role === "error") {
    questions.error_helpful = {
      type: "noul",
      instructions: "Does `text` say what went wrong and what the reader can do about it, in words they understand?",
    };
    questions.blames = { type: "noul", instructions: "Does `text` blame or scold the reader?" };
    questions.apologizes = { type: "noul", instructions: "Does `text` apologize, such as 'Sorry', 'Oops', or 'Unfortunately'?" };
  }
  return questions;
}

/** `found` is the text's strings when the caller has already extracted them. */
export async function evaluateCopy(input: { path: string; text: string; repo?: string; ref?: string; found?: CopyString[] }, options: CopyOptions = {}): Promise<CopyEvaluation> {
  const { runId, version, stats, issues, track, finish } = startRun();
  const all = input.found ?? extractCopy(input.path, input.text);
  const strings = all.filter((item) => !options.touched || options.touched.has(item.line)).slice(0, MAX_STRINGS);
  const proper = new Set([...ALWAYS_PROPER, ...(options.properNouns ?? []).flatMap((name) => name.split(/\s+/))]);
  const platform: Platform = input.path.endsWith(".swift") ? "mac" : "web";


  const page = all.slice(0, 40).map((item) => item.text);
  const answers = await Promise.all(
    strings.map((item) =>
      track(`copy:${input.path}:${item.line}`, { app: options.app ?? DEFAULT_APP[platform], page: input.path, role: item.role, text: item.text, other_text_on_the_page: page }, stringQuestions(item.role, item.text, platform))
    )
  );
  const results = strings.map((item, index) => judgeString(item, answers[index], proper, platform));

  const errors = [...issues, ...results.flatMap((result) => result.issues)].some((issue) => issue.severity === "error");
  const evaluation: CopyEvaluation = {
    kind: "copy",
    runId,
    version,
    repo: input.repo,
    ref: input.ref,
    path: input.path,
    verdict: errors ? "fail" : "pass",
    strings: results,
    issues,
    jev: stats,
  };
  return finish(evaluation, { tag: options.tag });
}

export function judgeString(item: CopyString, answers: Answers | undefined, proper: Set<string>, platform: Platform = "web"): CopyResult {
  const result: CopyResult = { text: item.text, role: item.role, line: item.line, issues: [], readings: {} };
  const add = (severity: Issue["severity"], message: string, source: string) => result.issues.push({ severity, part: item.role, message, source });
  const words = item.text.replace(/\{[^}]*\}/g, " ").split(/\s+/).filter((word) => /\p{L}/u.test(word));
  const letters = words.join("").replace(/[^\p{L}]/gu, "");

  // Exact findings.
  const sample = item.role === "placeholder" && !/\s/.test(item.text.trim());
  if (letters.length >= 3 && letters === letters.toUpperCase() && !sample && !words.every((word) => proper.has(word.replace(/[^\p{L}]/gu, "")) || ACRONYMS.has(word.replace(/[^\p{L}]/gu, "")))) {
    add("error", "Write it in sentence case, not ALL CAPS.", "fact:all-caps");
  } else if (platform === "mac" && TITLE_STYLE_ROLES.has(item.role)) {
    const style = mixedCase(words, proper);
    if (style) add("warn", `Use one style: Apple's title style ("Add to Favorites") or sentence style, not a mix (${style}).`, "fact:mixed-case");
  } else if (CASED_ROLES.has(item.role)) {
    const content = words.slice(1).map((word) => word.replace(/[^\p{L}'’-]/gu, "")).filter((word) => word && !SMALL_WORDS.has(word.toLowerCase()));
    const capitalized = content.filter((word) => /^\p{Lu}/u.test(word) && !proper.has(word) && !ACRONYM.test(word));
    if (capitalized.length >= 1 && capitalized.length >= content.length / 2) add("warn", `Use sentence case: only the first word and names take capitals ("${capitalized.join('", "')}").`, "fact:title-case");
  }
  // A count after the words, as in "Go ({count})", leaves them just as vague.
  const action = item.text.replace(/\s*\(\{[^}]*\}\)$/, "").trim();
  const standard = platform === "mac" && MAC_STANDARD_ACTION.test(action);
  if ((item.role === "button" || item.role === "link") && VAGUE_ACTION.test(action) && !standard) add("error", `"${item.text}" does not say what happens. Name the action, such as "Save changes".`, "fact:vague-action");
  if (APOLOGY.test(item.text)) add(item.role === "error" ? "error" : "warn", "Don't apologize. Say what happened and what to do next.", "fact:apology");
  // A file name is the more useful finding than the jargon ("json") inside it.
  if (FILE_PATH.test(item.text)) add("warn", "Don't show a file path or internal file name. Say where it is in words the reader knows.", "fact:file-path");
  else if (JARGON.test(item.text)) add("warn", "Uses technical words or codes a reader won't know.", "fact:jargon");
  if (item.text.includes("!")) add("warn", "Drop the exclamation mark.", "fact:exclamation");
  if (!answers) return result;

  const get = (key: string) => {
    if (!answers[key]) return undefined;
    const value = noul(answers, key);
    result.readings[key] = value;
    return value;
  };
  const low = (key: string, cut: number, message: string) => {
    const value = get(key);
    if (value !== undefined && value < cut) add("warn", message, jevSource(key, value));
  };
  const high = (key: string, cut: number, message: string) => {
    const value = get(key);
    if (value !== undefined && value >= cut) add("warn", message, jevSource(key, value));
  };
  const has = (source: string) => result.issues.some((issue) => issue.source.startsWith(source));

  if (!has("fact:jargon") && !has("fact:file-path")) low("plain", T.plain, "Use plainer words; this reads like jargon.");
  if (!has("fact:all-caps") && !has("fact:title-case")) low("sentence_case", T.sentenceCase, "Use sentence case.");
  high("passive", T.passive, "Say it in the active voice.");
  if (!has("fact:exclamation")) high("marketing", T.marketing, "Sounds like marketing. State it plainly.");
  high("wordy", T.wordy, "Say it in fewer words.");
  if (!has("fact:vague-action")) {
    low("action_clear", T.actionClear, "Say exactly what happens when it is pressed.");
    low("link_clear", T.actionClear, "Say where the link leads.");
  }
  low("error_helpful", T.errorHelpful, "Say what went wrong and how to fix it.");
  high("blames", T.blames, "Don't blame the reader.");
  if (!has("fact:apology")) high("apologizes", T.apologizes, "Don't apologize. Say what happened and what to do next.");
  return result;
}

// Title style capitalizes every word but the small ones; sentence style only the
// first. Returns what breaks both, or undefined when the text follows one.
function mixedCase(words: string[], proper: Set<string>): string | undefined {
  const rest = words.slice(1).map((word) => word.replace(/[^\p{L}'’-]/gu, "")).filter((word) => word && !proper.has(word) && !ACRONYM.test(word));
  const small = rest.filter((word) => TITLE_STYLE_SMALL.has(word.toLowerCase()));
  const content = rest.filter((word) => !TITLE_STYLE_SMALL.has(word.toLowerCase()));
  const capitalized = content.filter((word) => /^\p{Lu}/u.test(word));
  if (capitalized.length === 0) return undefined;
  const lowercase = content.filter((word) => !/^\p{Lu}/u.test(word));
  if (lowercase.length) return `"${capitalized.join('", "')}" capitalized but "${lowercase.join('", "')}" not`;
  const raised = small.filter((word) => /^\p{Lu}/u.test(word));
  return raised.length ? `title style keeps "${raised.join('", "')}" lowercase` : undefined;
}
