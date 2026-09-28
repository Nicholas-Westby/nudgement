import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { WorkshopId } from "../ids";
import { WorkshopName } from "./workshop-name";
import { buildInvite, type InviteDetails, inviteFileName } from "./invite";

const WORKSHOP_URL = "https://claybankstudio.com/workshops/3f1c2b9e-8a4d-4c1e-9b7a-2d5e6f708192";

function workshopId(value: string): WorkshopId {
  const result = WorkshopId.parse(value);
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.value;
}

function workshopName(value: string): WorkshopName {
  const result = WorkshopName.parse(value);
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.value;
}

function baseWorkshop(overrides: Partial<InviteDetails> = {}): InviteDetails {
  return {
    id: workshopId("3f1c2b9e-8a4d-4c1e-9b7a-2d5e6f708192"),
    name: workshopName("Friday Night Wheel"),
    courseName: "Test Course",
    format: "Glazing",
    startsAt: Temporal.Instant.from("2026-10-03T02:00:00Z"),
    endsAt: Temporal.Instant.from("2026-10-03T05:00:00Z"),
    ...overrides,
  };
}

// RFC 5545 folds a property onto a continuation line with a leading space or tab; undo
// that before checking lines so a fold landing mid-value doesn't break an assertion.
function unfoldedLines(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/g, "").split("\r\n");
}

describe("buildInvite", () => {
  it("opens the calendar with a published, versioned envelope", () => {
    const lines = unfoldedLines(buildInvite(baseWorkshop(), WORKSHOP_URL));

    expect(lines).toContain("BEGIN:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines).toContain("METHOD:PUBLISH");
    expect(lines.some((line) => line.startsWith("PRODID:"))).toBe(true);
  });

  it("identifies the workshop with a stable UID and its UTC start and end", () => {
    const lines = unfoldedLines(buildInvite(baseWorkshop(), WORKSHOP_URL));

    expect(lines).toContain("UID:3f1c2b9e-8a4d-4c1e-9b7a-2d5e6f708192@claybankstudio.com");
    expect(lines).toContain("DTSTART:20261003T020000Z");
    expect(lines).toContain("DTEND:20261003T050000Z");
  });

  it("carries the workshop's name, the studio's address and the booking link", () => {
    const lines = unfoldedLines(buildInvite(baseWorkshop(), WORKSHOP_URL));

    expect(lines).toContain("SUMMARY:Friday Night Wheel");
    expect(lines).toContain("LOCATION:Claybank Studio\\, 123 Main Street\\, Victoria\\, WA 98404");
    expect(lines.some((line) => line.startsWith("URL") && line.includes(WORKSHOP_URL))).toBe(true);
    expect(
      lines.some(
        (line) =>
          line.startsWith("DESCRIPTION") &&
          line.includes("Test Course\\, Glazing") &&
          line.includes(WORKSHOP_URL),
      ),
    ).toBe(true);
  });

  it("uses CRLF for every line break, never a bare LF", () => {
    const ics = buildInvite(baseWorkshop(), WORKSHOP_URL);
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("escapes semicolons and commas in the summary", () => {
    const workshop = baseWorkshop({ name: workshopName("Draft; bring snacks, please") });
    const lines = unfoldedLines(buildInvite(workshop, WORKSHOP_URL));
    expect(lines).toContain("SUMMARY:Draft\\; bring snacks\\, please");
  });

  it("escapes a semicolon in the description, not just the summary", () => {
    const workshop = baseWorkshop({ format: "Standard; casual play" });
    const lines = unfoldedLines(buildInvite(workshop, WORKSHOP_URL));
    expect(
      lines.some(
        (line) =>
          line.startsWith("DESCRIPTION") && line.includes("Test Course\\, Standard\\; casual play"),
      ),
    ).toBe(true);
  });
});

describe("inviteFileName", () => {
  it.each([
    ["Friday Night Wheel", "friday-night-wheel-2026-10-02.ics"],
    ["Raku League!", "raku-league-2026-10-02.ics"],
    ["!!!", "workshop-2026-10-02.ics"],
  ])("names %j as %j", (name, expected) => {
    const workshop = {
      name: workshopName(name),
      startsAt: Temporal.Instant.from("2026-10-03T02:00:00Z"),
    };
    expect(inviteFileName(workshop)).toBe(expected);
  });
});
