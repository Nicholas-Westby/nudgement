// Bun adds preconnect to fetch; test replacements need that property to satisfy its function type.
export function fakeFetch(response: () => Promise<Response>): typeof fetch {
  return Object.assign(response, { preconnect() {} });
}
