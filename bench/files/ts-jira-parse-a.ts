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

/** Scheme, optional credentials, host and optional port at the start of a URL. */
const URL_AUTHORITY = /^(https?):\/\/(?:[^@/?#\s]*@)?([^/?#:\s]+)(?::(\d*))?(?=[/?#]|$)/i;

/** Default ports that URL origins leave out. */
const DEFAULT_PORTS: Record<string, string> = { http: "80", https: "443" };

/** A Jira project key such as `SMRT1002`. */
export type ProjectKey = string & { readonly __brand: "ProjectKey" };

/** A canonical `https://<site>/browse/<KEY>` URL. */
export type BrowseUrl = string & { readonly __brand: "BrowseUrl" };

/** The scheme, host and port of a URL, e.g. `https://example.atlassian.net`. */
export type UrlOrigin = string & { readonly __brand: "UrlOrigin" };

/** A parsed Jira issue key such as `SMRT1002-2153`. */
export class IssueKey {
  private constructor(
    /** The project part, e.g. `SMRT1002`. */
    readonly project: ProjectKey,
    /** The issue number, e.g. `2153`. */
    readonly number: number,
    private readonly raw: string,
  ) {}

  /** Finds the first issue key in the text, or returns null. */
  static find(text: string): IssueKey | null {
    const match = ISSUE_KEY.exec(text);
    if (!match || match[1] === undefined || match[2] === undefined) return null;
    return new IssueKey(match[1] as ProjectKey, Number(match[2]), match[0]);
  }

  /** True when this key is the same issue as `other`. */
  equals(other: IssueKey): boolean {
    return this.raw === other.raw;
  }

  toString(): string {
    return this.raw;
  }
}

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
  const key = IssueKey.find(unwrapSlackLinks(text));
  return key ? key.toString() : null;
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
  const key = IssueKey.find(plain);
  if (!key) return null;

  return {
    issueKey: key.toString(),
    groupKey: key.project,
    url: canonicalBrowseUrl(plain, key),
  };
}

/**
 * Reads the origin (scheme, host and port) from an http(s) URL. Hosts are lowercased
 * and default ports dropped, so equivalent URLs give the same origin.
 */
function parseOrigin(raw: string): UrlOrigin | null {
  const match = URL_AUTHORITY.exec(raw);
  if (!match || match[1] === undefined || match[2] === undefined) return null;

  const scheme = match[1].toLowerCase();
  const host = match[2].toLowerCase();
  const port = match[3] ?? "";
  if (port === "" || port === DEFAULT_PORTS[scheme]) {
    return `${scheme}://${host}` as UrlOrigin;
  }
  return `${scheme}://${host}:${port}` as UrlOrigin;
}

/**
 * Rewrites whichever URL in the text mentions this issue into the canonical
 * `https://<site>/browse/<KEY>` form, dropping query strings such as `?atlOrigin=…`.
 */
function canonicalBrowseUrl(plainText: string, issueKey: IssueKey): BrowseUrl | null {
  for (const raw of plainText.match(URL_IN_TEXT) ?? []) {
    const origin = parseOrigin(raw);
    if (origin === null) continue;
    if (!raw.includes(issueKey.toString())) continue;
    return `${origin}/browse/${issueKey.toString()}` as BrowseUrl;
  }
  return null;
}
