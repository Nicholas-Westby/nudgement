import type { CopyResult, Platform } from "./copy-evaluate";
import type { CopyString } from "./copy-extract";
import { type Answers, noul } from "./jev";
import type { Issue } from "./message";
import { jevSource } from "./run";

// Benchmarked 2026-09-26 on 184 labelled strings in 20 views (bench/copy).
export const COPY_THRESHOLDS = {
  plain: 0.35,
  sentenceCase: 0.3,
  // Negated active phrases can score near 0.73, so the passive warning starts above that.
  passive: 0.7,
  actionClear: 0.35,
  errorHelpful: 0.2,
  blames: 0.6,
  apologizes: 0.6,
  marketing: 0.6,
  wordy: 0.88,
};

const T = COPY_THRESHOLDS;

export const ALWAYS_PROPER = [
  "I",
  "QR",
  "Apple",
  "iPhone",
  "Android",
  "OK",
  "Mac",
  "macOS",
  "Finder",
  "Safari",
  "iCloud",
];

// Acronyms a reader knows, which are not shouting.
const ACRONYMS = new Set(["URL", "API", "AI", "PDF", "ID", "OK", "QR"]);

const SMALL_WORDS = new Set(
  "a an and as at but by for from if in into of off on or per so than the to up via with".split(" "),
);

// Apple's title style leaves these lowercase: articles, coordinating conjunctions, prepositions of four letters or fewer.
const ACRONYM = /^\p{Lu}{2,}s?$/u;

const TITLE_STYLE_SMALL = new Set(
  "a an the and but or nor for so yet as at by from in into of off on onto out over per to up upon via with".split(" "),
);

// Roles whose capitals are checked: sentence case on the web, and on a Mac where title style does not apply.
export const CASED_ROLES = new Set(["title", "heading", "button", "link", "label", "option"]);

// Roles where a Mac app uses title style: buttons, menu items, window and section titles.
export const TITLE_STYLE_ROLES = new Set(["title", "heading", "button", "link", "option"]);

const VAGUE_ACTION =
  /^(submit|ok|okay|go|here|continue|send|done|next|yes|no|more|details|link|confirm|save|view|open|show)[.!]?$|^(click here|learn more|read more|more info)\b/i;

// A Mac sheet or alert's own buttons, which the dialog around them explains.
export const MAC_STANDARD_ACTION =
  /^(ok|cancel|done|save|open|send|continue|close|delete|add|show|hide|learn more)…?$/i;

// A button's state while or after it works, such as "Checking…" or Copy turning into "Copied".
export const BUTTON_STATE = /^\p{Lu}\p{Ll}+(ed|ing…)$/u;

const APOLOGY = /\b(sorry|oops|whoops|uh[- ]oh|apologi[sz]e|unfortunately)\b/i;

const JARGON =
  /\b(payload|null|undefined|NaN|invalid input|exception|stack trace|request failed|server error|uuid|json|http|utc|timestamp|template id)\b|\b[45]\d\d\b|\.ics\b|\((int|string|bool|number)\)|\b[a-z]+_[a-z_]+\b/i;

// A company or product left unnamed, when the reader needs to know which one.
// A path or an app's internal file shown to the reader; an extension alone (".quiltbook") is fine.
const FILE_PATH =
  /(^|[\s"“'(])(~\/|\/(Users|Library|Applications|System|Volumes|private|tmp|var)\/|\.[\w-]+\/)|\b[\w-]+\.(json|plist|sqlite|db|log|txt|md|yaml|yml|xml|csv|swift|ts|js)\b/;

export function judgeString(
  item: CopyString,
  answers: Answers | undefined,
  proper: Set<string>,
  platform: Platform = "web",
): CopyResult {
  const result: CopyResult = { text: item.text, role: item.role, line: item.line, issues: [], readings: {} };
  const add = (severity: Issue["severity"], message: string, source: string) =>
    result.issues.push({ severity, part: item.role, message, source });
  const words = item.text
    .replace(/\{[^}]*\}/g, " ")
    .split(/\s+/)
    .filter((word) => /\p{L}/u.test(word));
  const letters = words.join("").replace(/[^\p{L}]/gu, "");

  const sample = item.role === "placeholder" && !/\s/.test(item.text.trim());
  if (
    letters.length >= 3 &&
    letters === letters.toUpperCase() &&
    !sample &&
    !words.every((word) => proper.has(word.replace(/[^\p{L}]/gu, "")) || ACRONYMS.has(word.replace(/[^\p{L}]/gu, "")))
  ) {
    add("error", "Write it in sentence case, not ALL CAPS.", "fact:all-caps");
  } else if (platform === "mac" && TITLE_STYLE_ROLES.has(item.role)) {
    const style = mixedCase(words, proper);
    if (style)
      add(
        "warn",
        `Use one style: Apple's title style ("Add to Favorites") or sentence style, not a mix (${style}).`,
        "fact:mixed-case",
      );
  } else if (CASED_ROLES.has(item.role)) {
    const content = words
      .slice(1)
      .map((word) => word.replace(/[^\p{L}'’-]/gu, ""))
      .filter((word) => word && !SMALL_WORDS.has(word.toLowerCase()));
    const capitalized = content.filter((word) => /^\p{Lu}/u.test(word) && !proper.has(word) && !ACRONYM.test(word));
    if (capitalized.length >= 1 && capitalized.length >= content.length / 2)
      add(
        "warn",
        `Use sentence case: only the first word and names take capitals ("${capitalized.join('", "')}").`,
        "fact:title-case",
      );
  }
  // A count after the words, as in "Go ({count})", leaves them just as vague.
  const action = item.text.replace(/\s*\(\{[^}]*\}\)$/, "").trim();
  const standard = platform === "mac" && MAC_STANDARD_ACTION.test(action);
  if ((item.role === "button" || item.role === "link") && VAGUE_ACTION.test(action) && !standard)
    add(
      "error",
      `"${item.text}" does not say what happens. Name the action, such as "Save changes".`,
      "fact:vague-action",
    );
  if (APOLOGY.test(item.text))
    add(
      item.role === "error" ? "error" : "warn",
      "Don't apologize. Say what happened and what to do next.",
      "fact:apology",
    );
  // A file name is the more useful finding than the jargon ("json") inside it.
  if (FILE_PATH.test(item.text))
    add(
      "warn",
      "Don't show a file path or internal file name. Say where it is in words the reader knows.",
      "fact:file-path",
    );
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

  if (!has("fact:jargon") && !has("fact:file-path"))
    low("plain", T.plain, "Use plainer words; this reads like jargon.");
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

// Return a case error only when neither title style nor sentence style fits.
function mixedCase(words: string[], proper: Set<string>): string | undefined {
  const rest = words
    .slice(1)
    .map((word) => word.replace(/[^\p{L}'’-]/gu, ""))
    .filter((word) => word && !proper.has(word) && !ACRONYM.test(word));
  const small = rest.filter((word) => TITLE_STYLE_SMALL.has(word.toLowerCase()));
  const content = rest.filter((word) => !TITLE_STYLE_SMALL.has(word.toLowerCase()));
  const capitalized = content.filter((word) => /^\p{Lu}/u.test(word));
  if (capitalized.length === 0) return undefined;
  const lowercase = content.filter((word) => !/^\p{Lu}/u.test(word));
  if (lowercase.length) return `"${capitalized.join('", "')}" capitalized but "${lowercase.join('", "')}" not`;
  const raised = small.filter((word) => /^\p{Lu}/u.test(word));
  return raised.length ? `title style keeps "${raised.join('", "')}" lowercase` : undefined;
}
