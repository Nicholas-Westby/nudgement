// Provider prefixes and token-shape lengths identify likely credentials, not whether they are valid or active.
export const SECRETS: [string, RegExp][] = [
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["an AWS access key", /AKIA[0-9A-Z]{16}/],
  ["an API key", /\b(sk-[A-Za-z0-9_-]{20,}|apikey_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{35})/],
  ["a GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36}/],
  ["a Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
];

// Coarse git-grep candidates; secretKind applies the stricter shapes and fixture exemptions afterward.
export const SECRET_PREFIXES = [
  "PRIVATE KEY-----",
  "AKIA",
  "sk-",
  "apikey_",
  "AIza",
  "ghp_",
  "gho_",
  "ghu_",
  "ghs_",
  "ghr_",
  "xoxa-",
  "xoxb-",
  "xoxp-",
  "xoxr-",
  "xoxs-",
];

// Exempt readable fake keys used by fixtures. This heuristic is not a comprehensive secret scanner.
const WORDY = /(^|[-_])[a-z]+[-_][a-z]+[-_][a-z]+([-_]|$)/;

/** The kind of secret a line holds, if any. */
export function secretKind(text: string): string | undefined {
  for (const [name, pattern] of SECRETS) {
    const match = pattern.exec(text);
    if (match && !(WORDY.test(match[0]) && !/[A-Z]/.test(match[0].slice(4)))) return name;
  }
}
