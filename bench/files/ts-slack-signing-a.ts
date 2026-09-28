/**
 * Slack request signing.
 *
 * You do not normally write this — Bolt verifies inbound requests for you. You write it to
 * *drive* your app in tests: to hand Bolt a synthetic `app_mention` that it accepts as
 * genuine, you have to sign the request exactly as Slack would.
 *
 * The recipe (docs.slack.dev/authentication/verifying-requests-from-slack):
 *   1. base string = `v0:{unix-seconds}:{raw request body}`
 *   2. signature   = `v0=` + HMAC-SHA256(signing secret, base string), hex
 *   3. sent as `X-Slack-Signature`, with the timestamp in `X-Slack-Request-Timestamp`
 *   4. the receiver rejects timestamps older than five minutes (replay protection) and
 *      compares signatures in constant time.
 *
 * Note "raw request body": the bytes as received. If a JSON body-parser has already run
 * and you re-serialise `req.body`, key order or whitespace can differ and the signature
 * will not match. This is the single most common cause of `signature mismatch` in the wild.
 */
import { createHmac } from "node:crypto";

export interface SignedHeaders extends Record<string, string> {
  "content-type": string;
  "x-slack-signature": string;
  "x-slack-request-timestamp": string;
}

export function slackSignature(
  signingSecret: string,
  timestampSeconds: number,
  rawBody: string,
): string {
  const base = `v0:${timestampSeconds}:${rawBody}`;
  return `v0=${createHmac("sha256", signingSecret).update(base, "utf8").digest("hex")}`;
}

/** Headers for a request that Slack's own verifier will accept. */
export function signRequest(
  signingSecret: string,
  rawBody: string,
  timestampSeconds = Math.floor(Date.now() / 1000),
): SignedHeaders {
  return {
    "content-type": "application/json",
    "x-slack-signature": slackSignature(signingSecret, timestampSeconds, rawBody),
    "x-slack-request-timestamp": String(timestampSeconds),
  };
}
