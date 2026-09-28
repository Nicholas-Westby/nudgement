import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app";
import * as sheet from "../src/views/sign-up-sheet";
import { freshEnv, seedWorkshop, type TestEnv } from "./helpers/d1";

let env: TestEnv;

beforeEach(async () => {
  env = await freshEnv();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function workshopPage(workshopId: string) {
  const res = await app.request(`/workshops/${workshopId}`, {}, env);
  const html = await res.text();
  return { res, html, document: parseHTML(html).document };
}

function sheetLines(document: Document): string[] {
  const lines = document.querySelectorAll('ol[aria-label="Sign-up sheet"] > li');
  return [...lines].map((line) => line.textContent?.replace(/\s+/g, " ").trim() ?? "");
}

describe("GET /workshops/:id", () => {
  it("shows how many spots are taken out of the capacity", async () => {
    const potters = ["Ada", "Grace", "Alan", "Katherine", "Edsger", "Barbara", "Donald", "Frances", "Margaret"];
    const workshop = await seedWorkshop(env, { capacity: 16, potters });

    const { html } = await workshopPage(workshop.id);

    expect(html).toContain("9 of 16 spots taken");
  });

  it("draws one numbered line per spot", async () => {
    const workshop = await seedWorkshop(env, { capacity: 16 });

    const { document } = await workshopPage(workshop.id);

    expect(sheetLines(document)).toHaveLength(16);
  });

  it("fills the sheet's lines with potter names in booking order", async () => {
    const workshop = await seedWorkshop(env, { capacity: 3, potters: ["Ada Lovelace", "Grace Hopper"] });

    const { document } = await workshopPage(workshop.id);

    expect(sheetLines(document)).toEqual(["1 Ada Lovelace", "2 Grace Hopper", "3"]);
  });

  it("stamps a full workshop as full", async () => {
    const workshop = await seedWorkshop(env, { capacity: 2, potters: ["Ada Lovelace", "Grace Hopper"] });

    const { document } = await workshopPage(workshop.id);

    expect(document.querySelector('[role="status"]')?.textContent).toBe("Full");
  });

  it("shows the start and end time in Vancouver time", async () => {
    const workshop = await seedWorkshop(env, { startsAt: "2026-10-17T02:00:00Z", endsAt: "2026-10-17T05:00:00Z" });

    const { html } = await workshopPage(workshop.id);

    expect(html).toContain("Friday, October 16, 7:00 – 10:00 PM PDT");
  });

  it("escapes a potter's name so it cannot add markup to the page", async () => {
    const workshop = await seedWorkshop(env, { capacity: 8, potters: ["<img src=x onerror=alert(1)>"] });

    const { html } = await workshopPage(workshop.id);

    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x onerror");
  });

  it("renders a spot line for every spot", async () => {
    const spotLine = vi.spyOn(sheet, "SpotLine");
    const workshop = await seedWorkshop(env, { capacity: 16 });

    await workshopPage(workshop.id);

    expect(spotLine).toHaveBeenCalledTimes(16);
  });

  it("shows the page", async () => {
    const workshop = await seedWorkshop(env, {});

    const { res, html } = await workshopPage(workshop.id);

    expect(res.status).toBe(200);
    expect(html).toMatch(/spots/);
  });
});
