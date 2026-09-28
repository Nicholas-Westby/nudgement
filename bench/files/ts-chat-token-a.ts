/**
 * Chat gate: client day validation, visitor hashing and signed session tokens.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TOKEN_TTL_MS = 30 * 60 * 1000;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenPayload {
  day: string;
  visitor: string;
  exp: number;
}

/** The claims a token is expected to carry. */
export interface ExpectedClaims {
  day: string;
  visitor: string;
}

/** Hash algorithms supported for signing and hashing. */
export type HashAlgorithm = "SHA-256" | "SHA-384" | "SHA-512";

/** Options controlling how the gate signs, verifies and hashes. */
export interface GateOptions {
  /** Hash algorithm used for the HMAC and the visitor hash. */
  algorithm?: HashAlgorithm;
  /** Number of hex characters kept from the visitor hash. */
  visitorHashLength?: number;
  /** How many days either side of the UTC date a client day may be. */
  clockSkewDays?: number;
  /** Whether imported HMAC keys are cached between calls. */
  cacheKeys?: boolean;
  /** Whether rejected tokens are logged. */
  logFailures?: boolean;
}

const DEFAULT_OPTIONS: Required<GateOptions> = {
  algorithm: "SHA-256",
  visitorHashLength: 16,
  clockSkewDays: 1,
  cacheKeys: true,
  logFailures: true,
};

/** Outcome of a token verification, with the reason when it failed. */
export interface VerificationResult {
  valid: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Base class for every token failure. */
export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenError";
  }
}

export class MalformedTokenError extends TokenError {
  constructor(message = "Token is malformed") {
    super(message);
    this.name = "MalformedTokenError";
  }
}

export class InvalidSignatureError extends TokenError {
  constructor(message = "Token signature is invalid") {
    super(message);
    this.name = "InvalidSignatureError";
  }
}

export class ClaimMismatchError extends TokenError {
  constructor(message = "Token claims do not match") {
    super(message);
    this.name = "ClaimMismatchError";
  }
}

export class TokenExpiredError extends TokenError {
  constructor(message = "Token has expired") {
    super(message);
    this.name = "TokenExpiredError";
  }
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/** Conversions between strings, bytes and their text encodings. */
export class Encoding {
  private static readonly encoder = new TextEncoder();

  /** Encodes a string as UTF-8 bytes. */
  static utf8(value: string) {
    return Encoding.encoder.encode(value);
  }

  /** Converts a buffer to a lowercase hex string. */
  static toHex(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      const part = bytes[i].toString(16);
      hex += part.length === 1 ? "0" + part : part;
    }
    return hex;
  }

  /** Encodes bytes as unpadded base64url. */
  static toBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /** Decodes unpadded base64url back to a string. */
  static fromBase64Url(value: string): string {
    return atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  }
}

// ---------------------------------------------------------------------------
// Day checks and visitor hashing
// ---------------------------------------------------------------------------

export function utcDay(now: Date): string {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("utcDay expects a valid Date");
  }
  return now.toISOString().slice(0, 10);
}

/**
 * Local dates around the world span UTC-12 to UTC+14, so a visitor's own date
 * is always the UTC date, the one before, or the one after. Anything else is
 * either a bot that never bothered to send one or a replayed request.
 */
export function isPlausibleClientDay(
  clientDay: string,
  now: Date,
  options: GateOptions = {}
): boolean {
  const { clockSkewDays } = { ...DEFAULT_OPTIONS, ...options };
  if (typeof clientDay !== "string" || !DAY_RE.test(clientDay)) {
    console.debug(`[gate] Rejecting client day with bad format: ${clientDay}`);
    return false;
  }
  const parsed = Date.parse(`${clientDay}T00:00:00Z`);
  if (Number.isNaN(parsed)) {
    console.debug(`[gate] Rejecting unparseable client day: ${clientDay}`);
    return false;
  }
  const today = Date.parse(`${utcDay(now)}T00:00:00Z`);
  const plausible = Math.abs(parsed - today) <= clockSkewDays * DAY_MS;
  if (!plausible) {
    console.debug(`[gate] Client day ${clientDay} is too far from ${utcDay(now)}`);
  }
  return plausible;
}

/**
 * Identifies a visitor without storing an IP address. Salted with a secret so
 * the hash cannot be reversed by trying every address, and with the day so it
 * rotates every 24 hours.
 */
export async function visitorHash(
  ip: string,
  secret: string,
  day: string,
  options: GateOptions = {}
): Promise<string> {
  const { algorithm, visitorHashLength } = { ...DEFAULT_OPTIONS, ...options };
  if (!ip) {
    console.warn("[gate] visitorHash called without an IP address");
  }
  const data = Encoding.utf8(`${ip}|${secret}|${day}`);
  const digest = await crypto.subtle.digest(algorithm, data);
  return Encoding.toHex(digest).slice(0, visitorHashLength);
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/** Produces and checks signatures over token bodies. */
export interface TokenSigner {
  sign(body: string): Promise<string>;
  verify(body: string, signature: string): Promise<boolean>;
}

/** HMAC implementation of {@link TokenSigner}. */
export class HmacTokenSigner implements TokenSigner {
  private keyPromise: Promise<CryptoKey> | null = null;

  constructor(
    private readonly secret: string,
    private readonly options: Required<GateOptions> = DEFAULT_OPTIONS
  ) {}

  private getKey(): Promise<CryptoKey> {
    if (this.options.cacheKeys && this.keyPromise) {
      return this.keyPromise;
    }
    const promise = crypto.subtle.importKey(
      "raw",
      Encoding.utf8(this.secret),
      { name: "HMAC", hash: this.options.algorithm },
      false,
      ["sign"]
    );
    if (this.options.cacheKeys) {
      this.keyPromise = promise;
    }
    return promise;
  }

  async sign(body: string): Promise<string> {
    const key = await this.getKey();
    const mac = await crypto.subtle.sign("HMAC", key, Encoding.utf8(body));
    return Encoding.toBase64Url(new Uint8Array(mac));
  }

  async verify(body: string, signature: string): Promise<boolean> {
    const expected = await this.sign(body);
    return timingSafeEqual(expected, signature);
  }
}

// ---------------------------------------------------------------------------
// Token service
// ---------------------------------------------------------------------------

/** Issues and verifies signed chat session tokens. */
export class TokenService {
  private readonly options: Required<GateOptions>;
  private readonly signer: TokenSigner;

  constructor(secret: string, options: GateOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.signer = new HmacTokenSigner(secret, this.options);
  }

  /** Signs a payload into a `body.signature` token. */
  async issue(payload: TokenPayload): Promise<string> {
    if (!payload) {
      throw new TokenError("Cannot sign an empty payload");
    }
    const body = Encoding.toBase64Url(Encoding.utf8(JSON.stringify(payload)));
    const signature = await this.signer.sign(body);
    return `${body}.${signature}`;
  }

  /** Verifies a token and reports why it failed, if it did. */
  async check(token: string, expected: ExpectedClaims, now: Date): Promise<VerificationResult> {
    try {
      const payload = await this.decode(token);
      this.assertClaims(payload, expected, now);
      return { valid: true };
    } catch (error) {
      if (error instanceof TokenError) {
        if (this.options.logFailures) {
          console.log(`[gate] Token rejected: ${error.name}: ${error.message}`);
        }
        return { valid: false, reason: error.name };
      }
      console.error("[gate] Unexpected error while verifying a token:", error);
      return { valid: false, reason: "unexpected" };
    }
  }

  private async decode(token: string): Promise<TokenPayload> {
    if (typeof token !== "string" || token.length === 0) {
      throw new MalformedTokenError("Token must be a non-empty string");
    }
    const parts = token.split(".");
    if (parts.length !== 2) {
      throw new MalformedTokenError(`Expected 2 token parts, got ${parts.length}`);
    }
    const [body, signature] = parts;
    if (!body || !signature) {
      throw new MalformedTokenError("Token body or signature is empty");
    }

    let signatureValid: boolean;
    try {
      signatureValid = await this.signer.verify(body, signature);
    } catch (error) {
      throw new InvalidSignatureError(`Could not compute the signature: ${String(error)}`);
    }
    if (!signatureValid) {
      throw new InvalidSignatureError();
    }

    try {
      return JSON.parse(Encoding.fromBase64Url(body)) as TokenPayload;
    } catch {
      throw new MalformedTokenError("Token body is not valid JSON");
    }
  }

  private assertClaims(payload: TokenPayload, expected: ExpectedClaims, now: Date): void {
    if (payload.day !== expected.day) {
      throw new ClaimMismatchError(`Day mismatch: ${payload.day} !== ${expected.day}`);
    }
    if (payload.visitor !== expected.visitor) {
      throw new ClaimMismatchError("Visitor mismatch");
    }
    if (typeof payload.exp !== "number") {
      throw new MalformedTokenError("Token has no expiry");
    }
    if (payload.exp <= now.getTime()) {
      throw new TokenExpiredError();
    }
  }
}

/** Creates a {@link TokenService} for the given secret. */
export function createTokenService(secret: string, options?: GateOptions): TokenService {
  return new TokenService(secret, options);
}

export async function signToken(
  payload: TokenPayload,
  secret: string
): Promise<string> {
  return createTokenService(secret).issue(payload);
}

export async function verifyToken(
  token: string,
  secret: string,
  expected: { day: string; visitor: string },
  now: Date
): Promise<boolean> {
  const result = await createTokenService(secret).check(token, expected, now);
  return result.valid;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
