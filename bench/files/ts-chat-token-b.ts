export interface TokenPayload {
  day: string;
  visitor: string;
  exp: number;
}

export const TOKEN_TTL_MS = 30 * 60 * 1000;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Local dates around the world span UTC-12 to UTC+14, so a visitor's own date
 * is always the UTC date, the one before, or the one after. Anything else is
 * either a bot that never bothered to send one or a replayed request.
 */
export function isPlausibleClientDay(clientDay: string, now: Date): boolean {
  if (!DAY_RE.test(clientDay)) return false;
  const parsed = Date.parse(`${clientDay}T00:00:00Z`);
  if (Number.isNaN(parsed)) return false;
  const today = Date.parse(`${utcDay(now)}T00:00:00Z`);
  return Math.abs(parsed - today) <= DAY_MS;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Identifies a visitor without storing an IP address. Salted with a secret so
 * the hash cannot be reversed by trying every address, and with the day so it
 * rotates every 24 hours.
 */
export async function visitorHash(
  ip: string,
  secret: string,
  day: string
): Promise<string> {
  const data = new TextEncoder().encode(`${ip}|${secret}|${day}`);
  return toHex(await crypto.subtle.digest("SHA-256", data)).slice(0, 16);
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function sign(body: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body)
  );
  return b64url(new Uint8Array(mac));
}

export async function signToken(
  payload: TokenPayload,
  secret: string
): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await sign(body, secret)}`;
}

export async function verifyToken(
  token: string,
  secret: string,
  expected: { day: string; visitor: string },
  now: Date
): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [body, signature] = parts;
  if (!body || !signature) return false;

  let recomputed: string;
  try {
    recomputed = await sign(body, secret);
  } catch {
    return false;
  }
  if (!timingSafeEqual(recomputed, signature)) return false;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return false;
  }

  if (payload.day !== expected.day) return false;
  if (payload.visitor !== expected.visitor) return false;
  return typeof payload.exp === "number" && payload.exp > now.getTime();
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
