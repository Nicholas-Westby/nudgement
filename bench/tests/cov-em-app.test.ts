import { afterEach, expect, it, vi } from "vitest";
import { firstElement, linksIn, textOf } from "../tests/support/html";
import { postForm, testApp } from "../tests/support/test-app";

// Pages of our own, so the layout is tested without the calendar's database.
const app = testApp();
app.get("/plain", (c) => c.render("A page with no summary of its own.", { title: "Plain page" }));
app.get("/boom", () => {
  throw new Error("boom");
});
app.get("/described", (c) =>
  c.render("Details", { title: "Details", description: "A page with its own summary." }),
);

const CONTENT_SECURITY_POLICY =
  "default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; " +
  "form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

afterEach(() => {
  vi.restoreAllMocks();
});

async function get(path: string) {
  const response = await app.request(path);
  return { response, html: await response.text() };
}

function postWithHeaders(headers: Record<string, string>) {
  return app.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: "name=Alex",
  });
}

function silenceErrors() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

it("wraps a page in an English HTML document titled with the studio name", async () => {
  const { response, html } = await get("/plain");

  expect(response.status).toBe(200);
  expect(html.slice(0, 15)).toBe("<!DOCTYPE html>");
  expect(html).toContain('<html lang="en">');
  expect(textOf(firstElement(html, "title"))).toBe("Plain page – Claybank Studio");
});

it("describes a page for search results with the studio summary by default", async () => {
  const { html } = await get("/plain");

  expect(html).toContain(
    '<meta name="description" content="In-store pottery workshops at Claybank Studio in Victoria. Times are Vancouver."',
  );
});

it("uses a page's own description when it gives one", async () => {
  const { html } = await get("/described");

  expect(html).toContain('<meta name="description" content="A page with its own summary."');
});

it("links the design tokens, site styles and course colors in cascade order", async () => {
  const { html } = await get("/plain");

  const stylesheets = Array.from(
    html.matchAll(/<link rel="stylesheet" href="([^"]*)"/g),
    (match) => match[1],
  );
  expect(stylesheets).toEqual(["/styles/tokens.css", "/styles/site.css", "/courses.css"]);
});

it("links the studio's SVG favicon", async () => {
  const { html } = await get("/plain");

  expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg"');
});

it("starts the page with a skip link to the main content", async () => {
  const { html } = await get("/plain");

  const [firstLink] = linksIn(html.slice(html.indexOf("<body")));
  expect(firstLink).toEqual(["#main", "Skip to main content"]);
  expect(html).toContain('<main id="main" class="page">');
});

it("offers the calendar and workshop creation in the main navigation", async () => {
  const { html } = await get("/plain");

  const nav = firstElement(html, "nav");
  expect(nav).toMatch(/^<nav [^>]*aria-label="Main"/);
  expect(linksIn(nav)).toEqual([
    ["/", "Calendar"],
    ["/workshops/new", "Create a workshop"],
  ]);
});

it("shows the studio address and the time zone in the footer", async () => {
  const { html } = await get("/plain");

  const footer = textOf(firstElement(html, "footer"));
  expect(footer).toContain("Claybank Studio, 48 Harbour Road, Victoria, BC V8V 1A1");
  expect(footer).toContain("All times are Vancouver Time.");
});

it.each(["/plain", "/no-such-page", "/boom"])("sends no scripts with %s", async (path) => {
  silenceErrors();

  const { html } = await get(path);

  expect(html).not.toContain("<script");
});

it.each(["/plain", "/no-such-page", "/boom"])(
  "sends the security headers with %s",
  async (path) => {
    silenceErrors();

    const { response } = await get(path);

    expect(response.headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  },
);

it("answers an unknown address with a not-found page in the site layout", async () => {
  const { response, html } = await get("/no-such-page");

  expect(response.status).toBe(404);
  expect(textOf(firstElement(html, "title"))).toBe("Page not found – Claybank Studio");
  expect(textOf(firstElement(html, "h1"))).toBe("We can't find that page");
  expect(linksIn(firstElement(html, "main"))).toEqual([["/", "Go to the calendar"]]);
});

it("shows an error page and logs the failure as one JSON line when a route throws", async () => {
  const error = silenceErrors();

  const { response, html } = await get("/boom");

  expect(response.status).toBe(500);
  expect(textOf(firstElement(html, "h1"))).toBe("This page didn't load");
  expect(linksIn(firstElement(html, "main"))).toEqual([["/", "Go to the calendar"]]);
  expect(error.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
    {
      level: "error",
      workshop: "unhandled_error",
      message: "boom",
      stack: expect.stringContaining("Error: boom"),
      method: "GET",
      path: "/boom",
    },
  ]);
});

it("keeps the error's details off the error page", async () => {
  silenceErrors();

  const { html } = await get("/boom");

  expect(html).not.toContain("boom");
});

it.each([
  ["from another site", { Origin: "https://elsewhere.example" }],
  ["that names no origin", {}],
])("refuses a form post %s without logging an error", async (_case, headers) => {
  const error = silenceErrors();

  const response = await postWithHeaders(headers);

  expect(response.status).toBe(403);
  expect(error).not.toHaveBeenCalled();
});

it("lets a form post from this site through to the routes", async () => {
  const response = await app.request("/", postForm({ name: "Alex" }));

  expect(response.status).toBe(404);
});

it("refuses a form body over 16 KiB", async () => {
  const response = await app.request("/", postForm({ name: "a".repeat(16 * 1024) }));

  expect(response.status).toBe(413);
  expect(await response.text()).toBe("That form is too large to send.");
});
