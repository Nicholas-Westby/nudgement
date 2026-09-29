const TYPES = ["feat", "fix", "docs", "refactor", "test", "chore", "perf", "build", "ci", "style", "revert"] as const;

const SUBJECT_MAX = 72;
const BULLET_MAX = 80;
const BULLETS_MAX = 3;

export interface ParsedMessage {
  header: string;
  type?: string;
  scope?: string;
  breaking: boolean;
  subject?: string;
  bullets: string[];
  /** Body lines that are neither bullets nor blank. */
  prose: string[];
  trailers: string[];
  /** The message with trailers removed: what a reader judges. */
  judged: string;
  blankLineAfterHeader: boolean;
}

export type Severity = "error" | "warn" | "info";

export interface Issue {
  severity: Severity;
  /** What the issue is about: type, scope, subject, bullet 2, body, human, comment... */
  part: string;
  message: string;
  /** Where the finding came from: a lint rule name, or the Jev question and its reading. */
  source: string;
}

const RANK: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

/** Errors first, then warnings, then notes, each kept in the order found. */
export function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

// Trailers carry attribution and references, so exclude them from prose judgments.
const TRAILER = /^[A-Z][A-Za-z-]*(?: [A-Z][A-Za-z-]*)?: \S/;
const HEADER = /^([a-zA-Z]+)(?:\(([^()]*)\))?(!)?: (.*)$/;

export function parseMessage(message: string): ParsedMessage {
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  const header = lines[0] ?? "";
  let end = lines.length;
  while (end > 1 && lines[end - 1].trim() === "") end--;
  // Trailers are the last paragraph, when every line of it looks like one.
  let trailerStart = end;
  while (trailerStart > 1 && TRAILER.test(lines[trailerStart - 1])) trailerStart--;
  if (trailerStart < end && trailerStart > 1 && lines[trailerStart - 1].trim() !== "") trailerStart = end;
  const trailers = lines.slice(trailerStart, end);
  const body = lines.slice(1, trailerStart);

  const bullets: string[] = [];
  const prose: string[] = [];
  for (const line of body) {
    if (!line.trim()) continue;
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) bullets.push(bullet[1]);
    else if (bullets.length && /^\s{2,}\S/.test(line)) bullets[bullets.length - 1] += ` ${line.trim()}`;
    else prose.push(line);
  }

  const match = HEADER.exec(header);
  return {
    header,
    type: match?.[1],
    scope: match?.[2],
    breaking: !!match?.[3],
    subject: match?.[4],
    bullets,
    prose,
    trailers,
    judged: lines.slice(0, trailerStart).join("\n").trim(),
    blankLineAfterHeader: lines.length < 2 || lines[1].trim() === "",
  };
}

// House-style filler vocabulary; these words alone do not establish authorship.
const AI_WORDS =
  /\b(comprehensive|robust|seamless(ly)?|leverag(e|es|ing)|utiliz(e|es|ing)|streamlin(e|es|ed|ing)|enhanc(e|es|ed|ing|ement|ements)|delve|meticulous(ly)?|elevat(e|es|ing)|bolster|facilitat(e|es|ing)|holistic|cutting-edge|state-of-the-art|various improvements|this commit|this pr|this change (adds|introduces))\b/gi;
const EMOJI = /\p{Extended_Pictographic}/u;

export function aiWords(text: string): string[] {
  return [...new Set((text.match(AI_WORDS) ?? []).map((word) => word.toLowerCase()))];
}
const NOT_IMPERATIVE =
  /^(added|adds|adding|fixed|fixes|fixing|updated|updates|updating|removed|removes|removing|changed|changes|changing|implemented|implements|implementing|introduced|introduces|introducing|refactored|refactors|refactoring|created|creates|creating|improved|improves|improving|made|makes|making|moved|moves|moving|renamed|renames|renaming|used|uses|using)\b/i;
// Allow imperative verbs that happen to end in -ed or -ing.
const PAST_OR_ING = /^[a-z]+(ed|ing)\b/i;
const BASE_ENDING_ED_ING =
  /^(need|seed|feed|speed|embed|shed|bleed|breed|proceed|exceed|succeed|weed|heed|shred|bring|ring|sing|string|swing|sting|cling|fling|sling|spring|wring|ping)\b/i;

/** Whether the subject starts with a word that is not an order, such as "added" or "updating". */
function notImperative(subject: string): boolean {
  return NOT_IMPERATIVE.test(subject) || (PAST_OR_ING.test(subject) && !BASE_ENDING_ED_ING.test(subject));
}

export interface CommitRules {
  /** The house style for this repo has no trailer lines at all. */
  forbidTrailers?: boolean;
  /** Words that must not appear anywhere, commit messages included. */
  forbiddenWords?: string[];
}

export function lint(parsed: ParsedMessage, rules: CommitRules = {}): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Severity, part: string, message: string, rule: string) =>
    issues.push({ severity, part, message, source: `lint:${rule}` });

  if (!parsed.type) {
    add("error", "header", `The first line must look like "type(scope): subject". Got: "${parsed.header}"`, "format");
  } else {
    if (!TYPES.includes(parsed.type as (typeof TYPES)[number])) {
      add(
        "error",
        "type",
        `"${parsed.type}" is not a Conventional Commits type. Use one of: ${TYPES.join(", ")}.`,
        "type-known",
      );
    } else if (parsed.type !== parsed.type.toLowerCase()) {
      add("warn", "type", `Write the type in lowercase: "${parsed.type.toLowerCase()}".`, "type-case");
    }
    if (parsed.scope !== undefined && !parsed.scope.trim())
      add("error", "scope", "The scope is empty. Drop the parentheses or name the area.", "scope-empty");
    if (parsed.scope && /[A-Z\s]/.test(parsed.scope))
      add("warn", "scope", `Scopes are usually lowercase with no spaces: "${parsed.scope}".`, "scope-case");
    if (parsed.scope && parsed.scope.length > 24)
      add("warn", "scope", `The scope "${parsed.scope}" is long. A scope is usually one short word.`, "scope-length");
  }

  if (parsed.header.length > SUBJECT_MAX) {
    add(
      "error",
      "subject",
      `The first line is ${parsed.header.length} characters; the limit is ${SUBJECT_MAX}. Cut at least ${parsed.header.length - SUBJECT_MAX}.`,
      "header-length",
    );
  }
  const subject = parsed.subject ?? "";
  if (parsed.type && !subject.trim()) add("error", "subject", "The subject is empty.", "subject-empty");
  if (/[.!]$/.test(subject.trim()))
    add("error", "subject", "Drop the punctuation at the end of the subject.", "subject-period");
  if (/^[A-Z][a-z]/.test(subject))
    add(
      "warn",
      "subject",
      `Start the subject in lowercase: "${subject[0].toLowerCase()}${subject.slice(1)}".`,
      "subject-case",
    );
  if (notImperative(subject)) {
    add("warn", "subject", `Use the imperative mood ("add", not "${subject.split(/\s/)[0]}").`, "subject-imperative");
  }

  if (!parsed.blankLineAfterHeader)
    add("error", "body", "Leave a blank line between the first line and the body.", "blank-line");
  if (parsed.bullets.length > BULLETS_MAX) {
    add(
      "error",
      "body",
      `The body has ${parsed.bullets.length} bullets; the limit is ${BULLETS_MAX}. Keep the ones a reviewer needs.`,
      "bullet-count",
    );
  }
  parsed.bullets.forEach((bullet, index) => {
    const length = bullet.length + 2;
    if (length > BULLET_MAX)
      add(
        "warn",
        `bullet ${index + 1}`,
        `Bullet ${index + 1} is ${length} characters; keep bullets under ${BULLET_MAX}.`,
        "bullet-length",
      );
  });
  // Git writes "This reverts commit ..." into a revert's body, so that prose is expected.
  if (parsed.prose.length && parsed.type !== "revert") {
    add(
      "error",
      "body",
      `The body has ${parsed.prose.length} line(s) of prose. Use at most ${BULLETS_MAX} "- " bullets instead.`,
      "body-bullets-only",
    );
  }
  if (/^\s*\*\s/m.test(parsed.judged)) add("warn", "body", 'Use "- " for bullets, not "* ".', "bullet-marker");
  if (/^\s{2,}[-*]\s/m.test(parsed.judged)) add("warn", "body", "Avoid nested bullets.", "bullet-nested");
  if (/^#{1,6}\s|\*\*[^*]+\*\*/m.test(parsed.judged))
    add("warn", "body", "Avoid Markdown headings and bold text in commit messages.", "markdown");

  if (EMOJI.test(parsed.judged)) add("warn", "human", "Remove the emoji.", "emoji");
  const words = aiWords(parsed.judged);
  if (words.length)
    add(
      "warn",
      "human",
      `Words that read as AI-written: ${words.map((word) => `"${word}"`).join(", ")}. Say concretely what changed.`,
      "ai-words",
    );

  if (rules.forbidTrailers && parsed.trailers.length) {
    add(
      "error",
      "trailers",
      `Remove the trailer lines (${parsed.trailers.map((line) => line.split(":")[0]).join(", ")}): this repo's commits carry none.`,
      "trailers",
    );
  }
  const whole = [parsed.judged, ...parsed.trailers].join("\n");
  for (const word of rules.forbiddenWords ?? []) {
    if (new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(whole))
      add("error", "words", `Remove "${word}" from the message.`, "forbidden-word");
  }

  return issues;
}
