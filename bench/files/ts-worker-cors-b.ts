/**
 * HTTP utilities for the API worker.
 *
 * Provides CORS handling, JSON response helpers and request origin resolution
 * for every route the worker serves.
 */

// ============================================================================
// Types
// ============================================================================

/** HTTP methods the worker can advertise in a CORS preflight. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

/** A map of header names to header values. */
export type HeaderMap = Record<string, string>;

/** Configuration options for CORS handling. */
export interface CorsOptions {
  /** Methods allowed for cross-origin requests. */
  allowedMethods?: HttpMethod[];
  /** Request headers allowed for cross-origin requests. */
  allowedHeaders?: string[];
  /** How long, in seconds, a browser may cache the preflight response. */
  maxAge?: number;
  /** Whether http://localhost:<port> origins are accepted (local development). */
  allowLocalhost?: boolean;
  /** Whether the non-www variant of the allowed origin is accepted. */
  allowNonWww?: boolean;
}

/** Default CORS options, used when a caller does not override them. */
export const DEFAULT_CORS_OPTIONS: Required<CorsOptions> = {
  allowedMethods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-Chat-Day"],
  maxAge: 86400,
  allowLocalhost: true,
  allowNonWww: true,
};

// ============================================================================
// Origin matching
// ============================================================================

/**
 * Strategy for deciding whether a request origin is acceptable.
 */
export interface OriginMatcher {
  /** Name of the matcher, used in log output. */
  readonly name: string;
  /**
   * Returns true when the origin matches.
   * @param origin - The origin of the incoming request.
   * @param allowedOrigin - The origin configured for the site.
   */
  matches(origin: string, allowedOrigin: string): boolean;
}

/** Matches an origin that is exactly the allowed origin. */
class ExactOriginMatcher implements OriginMatcher {
  readonly name = "exact";

  matches(origin: string, allowedOrigin: string): boolean {
    return origin === allowedOrigin;
  }
}

/** Matches any http://localhost:<port> origin. */
class LocalhostOriginMatcher implements OriginMatcher {
  readonly name = "localhost";
  private static readonly PATTERN = /^http:\/\/localhost:\d+$/;

  matches(origin: string): boolean {
    return LocalhostOriginMatcher.PATTERN.test(origin);
  }
}

/** Matches the non-www variant of the allowed origin. */
class NonWwwOriginMatcher implements OriginMatcher {
  readonly name = "non-www";

  matches(origin: string, allowedOrigin: string): boolean {
    return origin === allowedOrigin.replace("://www.", "://");
  }
}

/**
 * Builds the ordered list of origin matchers for a set of options.
 * @param options - The CORS options.
 * @returns The matchers to try, in order.
 */
export function createOriginMatchers(options: CorsOptions = {}): OriginMatcher[] {
  const resolved = { ...DEFAULT_CORS_OPTIONS, ...options };
  const matchers: OriginMatcher[] = [new ExactOriginMatcher()];
  if (resolved.allowLocalhost) {
    matchers.push(new LocalhostOriginMatcher());
  }
  if (resolved.allowNonWww) {
    matchers.push(new NonWwwOriginMatcher());
  }
  return matchers;
}

// ============================================================================
// CORS policy
// ============================================================================

/**
 * Encapsulates the worker's CORS policy.
 */
export class CorsPolicy {
  private readonly options: Required<CorsOptions>;
  private readonly matchers: OriginMatcher[];

  constructor(
    private readonly allowedOrigin: string,
    options: CorsOptions = {}
  ) {
    this.options = { ...DEFAULT_CORS_OPTIONS, ...options };
    this.matchers = createOriginMatchers(this.options);
  }

  /**
   * Checks whether an origin may call the API.
   * @param origin - The origin of the incoming request.
   * @returns True if the origin is allowed, false otherwise.
   */
  isAllowed(origin: string): boolean {
    if (origin === null || origin === undefined || typeof origin !== "string") {
      console.warn("[cors] Received an invalid origin:", origin);
      return false;
    }
    if (origin.length === 0) {
      console.debug("[cors] Empty origin, rejecting");
      return false;
    }
    for (const matcher of this.matchers) {
      if (matcher.matches(origin, this.allowedOrigin)) {
        console.debug(`[cors] Origin ${origin} allowed by the ${matcher.name} matcher`);
        return true;
      }
    }
    console.debug(`[cors] Origin ${origin} is not allowed`);
    return false;
  }

  /**
   * Builds the CORS headers for a response.
   * @param origin - The origin of the incoming request.
   * @returns The headers to add to the response.
   */
  headersFor(origin: string): HeaderMap {
    const headers: HeaderMap = {
      "Access-Control-Allow-Methods": this.options.allowedMethods.join(", "),
      "Access-Control-Allow-Headers": this.options.allowedHeaders.join(", "),
      "Access-Control-Max-Age": String(this.options.maxAge),
    };
    if (this.isAllowed(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
    }
    return headers;
  }
}

/**
 * Factory for {@link CorsPolicy}.
 * @param allowedOrigin - The origin configured for the site.
 * @param options - Optional CORS options.
 * @returns A new CorsPolicy.
 */
export function createCorsPolicy(allowedOrigin: string, options?: CorsOptions): CorsPolicy {
  if (!allowedOrigin) {
    console.warn("[cors] No allowed origin configured; only localhost will be accepted");
  }
  return new CorsPolicy(allowedOrigin, options);
}

// ============================================================================
// Public helpers
// ============================================================================

/**
 * Checks whether the given origin is allowed to call the API.
 * @param origin - The origin of the incoming request.
 * @param allowedOrigin - The origin configured for the site.
 * @returns True if the origin is allowed.
 */
export function isAllowedOrigin(origin: string, allowedOrigin: string): boolean {
  return createCorsPolicy(allowedOrigin).isAllowed(origin);
}

/**
 * Returns the CORS headers for a response to the given origin.
 * @param origin - The origin of the incoming request.
 * @param allowedOrigin - The origin configured for the site.
 * @returns A record of CORS headers.
 */
export function corsHeaders(
  origin: string,
  allowedOrigin: string
): Record<string, string> {
  return createCorsPolicy(allowedOrigin).headersFor(origin);
}

/**
 * Creates a JSON response with CORS headers attached.
 * @param data - The data to serialize as the response body.
 * @param status - The HTTP status code.
 * @param origin - The origin of the incoming request.
 * @param allowedOrigin - The origin configured for the site.
 * @returns The response.
 */
export function jsonResponse(
  data: Record<string, unknown>,
  status: number,
  origin: string,
  allowedOrigin: string
): Response {
  let body: string;
  try {
    body = JSON.stringify(data);
  } catch (error) {
    console.error("[http] Failed to serialize the response body:", error);
    throw error;
  }

  const headers: HeaderMap = {
    "Content-Type": "application/json",
    ...corsHeaders(origin, allowedOrigin),
  };

  console.debug(`[http] Sending JSON response with status ${status}`);
  return new Response(body, { status, headers });
}

/**
 * Resolves the origin a request came from.
 *
 * Browsers omit `Origin` on same-origin GET requests, so a page on the site
 * calling its own API sends nothing at all. Fall back to the origin of the
 * page that made the call, which is present for same-origin requests under
 * the default referrer policy.
 *
 * @param request - The incoming request.
 * @returns The origin, or an empty string when it cannot be determined.
 */
export function requestOrigin(request: Request): string {
  if (!request || !request.headers) {
    console.warn("[http] requestOrigin was called without a valid request");
    return "";
  }

  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== undefined && origin !== "") {
    console.debug(`[http] Using the Origin header: ${origin}`);
    return origin;
  }

  const referer = request.headers.get("Referer");
  if (referer === null || referer === undefined || referer === "") {
    console.debug("[http] No Origin or Referer header present");
    return "";
  }

  try {
    const parsed = new URL(referer);
    console.debug(`[http] Falling back to the Referer origin: ${parsed.origin}`);
    return parsed.origin;
  } catch (error) {
    console.warn(`[http] Could not parse the Referer header "${referer}":`, error);
    return "";
  }
}
