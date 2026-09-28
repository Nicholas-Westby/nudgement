export function isAllowedOrigin(origin: string, allowedOrigin: string): boolean {
  if (!origin) return false;
  if (origin === allowedOrigin) return true;
  if (/^http:\/\/localhost:\d+$/.test(origin)) return true;
  // Also allow the non-www variant
  return origin === allowedOrigin.replace("://www.", "://");
}

export function corsHeaders(
  origin: string,
  allowedOrigin: string
): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Chat-Day",
    "Access-Control-Max-Age": "86400",
  };
  if (isAllowedOrigin(origin, allowedOrigin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export function jsonResponse(
  data: Record<string, unknown>,
  status: number,
  origin: string,
  allowedOrigin: string
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin, allowedOrigin),
    },
  });
}

/**
 * The origin a request came from.
 *
 * Browsers omit `Origin` on same-origin GET requests, so a page on the site
 * calling its own API sends nothing at all. Fall back to the origin of the
 * page that made the call, which is present for same-origin requests under
 * the default referrer policy.
 */
export function requestOrigin(request: Request): string {
  const origin = request.headers.get("Origin");
  if (origin) return origin;

  const referer = request.headers.get("Referer");
  if (!referer) return "";
  try {
    return new URL(referer).origin;
  } catch {
    return "";
  }
}
