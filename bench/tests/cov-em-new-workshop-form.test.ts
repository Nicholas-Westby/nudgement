import { describe, expect, it } from "vitest";
import { FIXED_NOW } from "../../tests/support/fixtures";
import { CourseTemplate } from "../courses/course-template";
import { blankFields, type NewWorkshopFields, parseNewWorkshopForm } from "./new-workshop-form";

// A template with no connection to any real course, so form-parsing rules are tested
// without depending on the shipped catalogue.
function neutralCourse(): CourseTemplate {
  const parsed = CourseTemplate.parse("neutral-course", {
    name: "Neutral Course",
    workshop: {
      formats: ["Standard", "Draft"],
      defaultDurationMinutes: 180,
      defaultCapacity: 16,
      minPotters: 4,
    },
    content: {
      description: "A neutral course used only in tests.",
      whatToBring: "Nothing special.",
      color: "#123456",
      logo: {
        src: "/images/courses/neutral/logo.webp",
        width: 100,
        height: 50,
        alt: "Neutral Course",
      },
      art: {
        src: "/images/courses/neutral/art-1200.webp",
        smallSrc: "/images/courses/neutral/art-600.webp",
        width: 1200,
        height: 800,
        alt: "Neutral Course",
      },
    },
  });
  if (!parsed.ok) throw new Error(`expected a valid template, got: ${parsed.error}`);
  return parsed.value;
}

const VALID_BODY: NewWorkshopFields = {
  name: "Friday Night Standard",
  format: "Standard",
  date: "2026-10-02",
  time: "19:00",
  duration: "180",
  capacity: "12",
};

describe("blankFields", () => {
  it("fills format, duration and capacity from the template, leaving the rest empty", () => {
    expect(blankFields(neutralCourse())).toEqual({
      name: "",
      format: "Standard",
      date: "",
      time: "",
      duration: "180",
      capacity: "16",
    });
  });
});

describe("parseNewWorkshopForm", () => {
  const course = neutralCourse();

  it("turns a complete valid submission into a NewWorkshop", () => {
    const result = parseNewWorkshopForm(VALID_BODY, course, FIXED_NOW);

    if (!result.ok) throw new Error(`expected ok, got: ${JSON.stringify(result.errors)}`);
    expect(result.value.name.value).toBe("Friday Night Standard");
    expect(result.value.startsAt.toString()).toBe("2026-10-03T02:00:00Z");
    expect(result.value.duration.minutes).toBe(180);
    expect(result.value.capacity.value).toBe(12);
    expect(result.value.format).toBe("Standard");
    expect(result.value.courseId).toBe("neutral-course");
    expect(result.value.courseName).toBe("Neutral Course");
    expect(result.value.minPotters).toBe(4);
  });

  it("accepts a date exactly a year (365 days) after today", () => {
    // studioToday(FIXED_NOW) is 2026-09-26 Vancouver, so this is the last date the form's own
    // `max` attribute offers; the parser must not reject the day the input still allows.
    const result = parseNewWorkshopForm(
      { ...VALID_BODY, date: "2027-09-26", time: "19:00" },
      course,
      FIXED_NOW,
    );

    if (!result.ok) throw new Error(`expected ok, got: ${JSON.stringify(result.errors)}`);
    expect(result.value.startsAt.toString()).toBe("2027-09-27T02:00:00Z");
  });

  it.each([
    ["an empty name", { ...VALID_BODY, name: "" }, "name", "Give the workshop a name."],
    [
      "a format the template doesn't offer",
      { ...VALID_BODY, format: "Beginner" },
      "format",
      "Pick one of the listed formats.",
    ],
    ["an invalid date", { ...VALID_BODY, date: "2026-02-30" }, "date", "Pick a date."],
    ["an invalid time", { ...VALID_BODY, time: "7pm" }, "time", "Pick a start time."],
    [
      "a start that has already passed",
      { ...VALID_BODY, date: "2026-09-26", time: "11:00" },
      "date",
      "Pick a date and start time that haven't passed.",
    ],
    [
      "a start exactly at the current moment",
      { ...VALID_BODY, date: "2026-09-26", time: "12:00" },
      "date",
      "Pick a date and start time that haven't passed.",
    ],
    [
      "a start more than a year out",
      { ...VALID_BODY, date: "2027-09-27", time: "19:00" },
      "date",
      "Pick a date within the next year.",
    ],
    [
      "a duration the template doesn't offer",
      { ...VALID_BODY, duration: "45" },
      "duration",
      "Pick how long the workshop runs.",
    ],
    [
      "a capacity under the template's minimum",
      { ...VALID_BODY, capacity: "3" },
      "capacity",
      "This course needs at least 4 potters, so set at least 4 spots.",
    ],
    [
      "a capacity over the studio limit",
      { ...VALID_BODY, capacity: "31" },
      "capacity",
      "The studio has 30 spots, so set 30 or fewer.",
    ],
    [
      "a non-numeric capacity",
      { ...VALID_BODY, capacity: "lots" },
      "capacity",
      "Enter the number of spots as a whole number.",
    ],
  ])("reports %s on the right field", (_label, body, field, message) => {
    const result = parseNewWorkshopForm(body, course, FIXED_NOW);

    if (result.ok) throw new Error("expected the form to be rejected");
    expect(result.errors[field as keyof typeof result.errors]).toBe(message);
  });

  it("reports every failing field at once and echoes the raw input back", () => {
    const body = {
      name: "",
      format: "Beginner",
      date: "2026-10-02",
      time: "19:00",
      duration: "180",
      capacity: "31",
    };

    const result = parseNewWorkshopForm(body, course, FIXED_NOW);

    if (result.ok) throw new Error("expected the form to be rejected");
    expect(result.errors).toEqual({
      name: "Give the workshop a name.",
      format: "Pick one of the listed formats.",
      capacity: "The studio has 30 spots, so set 30 or fewer.",
    });
    expect(result.fields).toEqual(body);
  });
});
