export function fakeFetch(response: () => Promise<Response>): typeof fetch {
  return Object.assign(response, { preconnect() {} });
}
