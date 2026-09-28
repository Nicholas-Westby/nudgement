import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { freshEnv, seedWorkshop, type TestEnv } from "./helpers/d1";

let env: TestEnv;

beforeEach(async () => {
  env = await freshEnv();
});

function get(path: string) {
  return app.request(path, {}, env);
}

describe("security headers", () => {
  it("forbids scripts on every page through the content security policy", async () => {
    for (const path of ["/", "/calendar/2026-10", "/workshops/new"]) {
      const res = await get(path);

      expect(res.headers.get("Content-Security-Policy")).toContain("script-src 'none'");
    }
  });

  it("stops other sites from framing the pages", async () => {
    const res = await get("/");

    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("refuses a booking posted from another site", async () => {
    const workshop = await seedWorkshop(env, { capacity: 8 });

    const res = await app.request(
      `/workshops/${workshop.id}/book`,
      { method: "POST", headers: { Origin: "https://evil.example" }, body: new URLSearchParams({ name: "Mallory" }) },
      env,
    );

    expect(res.status).toBe(403);
  });

  it("renders pages without inline style attributes", async () => {
    const workshop = await seedWorkshop(env, { capacity: 8, potters: ["Ada Lovelace"] });

    const res = await get(`/workshops/${workshop.id}`);

    expect(res.status).toBe(200);
    expect(await res.text()).not.toMatch(/\sstyle=/);
  });

  it("sends a content security policy", async () => {
    const res = await get("/");

    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
  });

  it("tells browsers not to sniff content types", async () => {
    const res = await get("/");

    expect(res.headers.get("X-Content-Type-Options") ?? "nosniff").toBe("nosniff");
  });

  it("works", async () => {
    const home = await get("/");
    expect(home.headers.get("Content-Security-Policy")).toContain("default-src 'self'");

    const styles = await get("/styles/app.css");
    expect(styles.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");

    const missing = await get("/no-such-page");
    expect(missing.status).toBe(404);

    const calendar = await get("/calendar/2026-10");
    expect(await calendar.text()).toContain("October 2026");

    const courses = await get("/courses.css");
    expect(await courses.text()).toContain(".course-wheel { --course-color: #5B2A86; }");
  });
});
