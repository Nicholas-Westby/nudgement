import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { freshEnv, seedWorkshop, type TestEnv } from "./helpers/d1";

let env: TestEnv;

beforeEach(async () => {
  env = await freshEnv();
});

function download(workshopId: string) {
  return app.request(`/workshops/${workshopId}/invite.ics`, {}, env);
}

// RFC 5545 folds lines longer than 75 bytes; unfold them so each property is one line.
async function inviteLines(workshopId: string): Promise<string[]> {
  const ics = await (await download(workshopId)).text();
  return ics.replace(/\r\n[ \t]/g, "").split("\r\n");
}

describe("GET /workshops/:id/invite.ics", () => {
  it("serves the invite as a calendar file named after the workshop", async () => {
    const workshop = await seedWorkshop(env, { name: "Friday Night Wheel" });

    const res = await download(workshop.id);

    expect(res.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="friday-night-wheel.ics"');
  });

  it("gives the start and end times in UTC", async () => {
    // 7:00 PM to 10:00 PM PDT on Friday, October 16.
    const workshop = await seedWorkshop(env, { startsAt: "2026-10-17T02:00:00Z", endsAt: "2026-10-17T05:00:00Z" });

    const lines = await inviteLines(workshop.id);

    expect(lines).toContain("DTSTART:20261017T020000Z");
    expect(lines).toContain("DTEND:20261017T050000Z");
  });

  it("uses the workshop name as the title", async () => {
    const workshop = await seedWorkshop(env, { name: "Raku League Challenge" });

    expect(await inviteLines(workshop.id)).toContain("SUMMARY:Raku League Challenge");
  });

  it("puts the studio's address in the location", async () => {
    const workshop = await seedWorkshop(env, {});

    expect(await inviteLines(workshop.id)).toContain("LOCATION:Claybank Studio\\, 412 Alder St\\, Portland\\, OR 97205");
  });

  it("escapes commas and semicolons in the workshop name", async () => {
    const workshop = await seedWorkshop(env, { name: "Taster; then Beginner, then pizza" });

    expect(await inviteLines(workshop.id)).toContain("SUMMARY:Taster\\; then Beginner\\, then pizza");
  });

  it("identifies the invite by the workshop id so importing it again updates the same entry", async () => {
    const workshop = await seedWorkshop(env, {});

    const uid = (await inviteLines(workshop.id)).find((line) => line.startsWith("UID:"));

    expect(uid).toBe(`UID:${workshop.id}@claybankstudio.com`);
  });

  it("returns 404 instead of an invite for an unknown workshop", async () => {
    const res = await download("0d9f5c1e-8a7b-4c6d-9e2f-3a4b5c6d7e8f");

    expect(res.status).toBe(404);
  });
});
