/**
 * Turning a chunk of Slack message text into "which Jira issue, and therefore which
 * reviewer group?".
 *
 * Two things make this fiddlier than it looks:
 *
 * 1. Slack does not hand you the raw text a human typed. It hands you *escaped* text with
 *    links wrapped in angle brackets: `<https://example.com|label>`. See
 *    docs/research/02-messaging-mentions-threads.md.
 * 2. Jira project keys may contain digits (`SMRT1002`), so the naive `/([A-Z]+)-(\d+)/`
 *    regex fails to match `SMRT1002-2153` at all. The character class after the first
 *    letter must include digits, and the match must be anchored on word boundaries.
 */

/**
 * A Jira issue key: a project key (letter, then letters/digits/underscores) followed by a
 * hyphen and the issue number. Anchored with `\b` on both ends so that:
 *   - `1ABC-22` does not match (a key must start with a letter, and `\b` will not let the
 *     regex start scanning mid-word at the `A`), and
 *   - `SMRT1002-2153` matches whole rather than splitting.
 */
const ISSUE_KEY = /\b([A-Z][A-Z0-9_]*)-(\d+)\b/;

/** A bare URL, stopping at whitespace and at Slack's link delimiters. */
const URL_IN_TEXT = /https?:\/\/[^\s<>|]+/g;

/** Slack link encodings: `<url>` and `<url|label>`. */
const SLACK_LINK = /<(https?:\/\/[^\s|>]+)(?:\|[^>]*)?>/g;

/** Replaces Slack's `<url|label>` link encoding with the bare URL. */
export function unwrapSlackLinks(text: string): string {
  return text.replace(SLACK_LINK, (_match, url: string) => url);
}

/** Undoes the three characters Slack escapes on the way in. */
export function unescapeSlackText(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Removes any leading `<@U…>` bot mention so the rest of the text can be parsed. */
export function stripBotMention(text: string): string {
  return text.replace(/<@[UWB][A-Z0-9]+(?:\|[^>]*)?>/g, " ").trim();
}

/**
 * Pulls the first Jira issue key out of arbitrary message text — a bare key, a `/browse/`
 * URL, a modern board URL with `?selectedIssue=`, or a Service Management queue URL.
 */
export function extractIssueKey(text: string): string | null {
  const match = ISSUE_KEY.exec(unwrapSlackLinks(text));
  return match ? match[0] : null;
}

/**
 * The group key is the issue key with its trailing `-<digits>` removed, i.e. the Jira
 * project key. `SMRT1002-2153` → `SMRT1002`.
 */
export function groupKeyFromIssueKey(issueKey: string): string {
  return issueKey.replace(/-\d+$/, "");
}

export interface ParsedRequest {
  /** e.g. `SMRT1002-2153` */
  issueKey: string;
  /** e.g. `SMRT1002` — the reviewer group this request belongs to. */
  groupKey: string;
  /** Canonical `/browse/` URL, or null when only a bare key was supplied. */
  url: string | null;
}

/**
 * Parses one `@PrReview <something>` request. Returns null when the text contains no
 * recognisable issue key.
 */
export function parseRequest(text: string): ParsedRequest | null {
  const plain = unwrapSlackLinks(text);
  const issueKey = extractIssueKey(plain);
  if (!issueKey) return null;

  return {
    issueKey,
    groupKey: groupKeyFromIssueKey(issueKey),
    url: canonicalBrowseUrl(plain, issueKey),
  };
}

/**
 * Rewrites whichever URL in the text mentions this issue into the canonical
 * `https://<site>/browse/<KEY>` form, dropping query strings such as `?atlOrigin=…`.
 */
function canonicalBrowseUrl(plainText: string, issueKey: string): string | null {
  for (const raw of plainText.match(URL_IN_TEXT) ?? []) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    if (!raw.includes(issueKey)) continue;
    return `${parsed.origin}/browse/${issueKey}`;
  }
  return null;
}
