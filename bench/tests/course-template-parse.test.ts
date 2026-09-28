import { describe, expect, it } from "vitest";
import { CourseTemplate } from "../src/courses/course-template";

const wheel = {
  name: "Wheel Throwing",
  workshop: {
    formats: ["Standard", "Glazing", "Open Studio", "Beginner"],
    defaultDurationMinutes: 180,
    defaultCapacity: 16,
    minPotters: 4,
  },
  content: {
    description: "Make a mug, sit down with strangers, leave with friends.",
    whatToBring: "An apron, short nails and clothes that can get muddy.",
    color: "#5B2A86",
    logo: { src: "/images/courses/wheel/logo.webp", width: 240, height: 80, alt: "Wheel Throwing" },
    art: { src: "/images/courses/wheel/art.webp", width: 1200, height: 400, alt: "A potter trimming a bowl" },
  },
};

function withWorkshop(changes: Record<string, unknown>) {
  return { ...wheel, workshop: { ...wheel.workshop, ...changes } };
}

function error(json: unknown): string {
  const result = CourseTemplate.parse("wheel", json);
  if (result.ok) throw new Error("expected the template to be rejected");
  return result.error;
}

describe("CourseTemplate.parse", () => {
  it("reads the formats, duration, default capacity and minimum potters", () => {
    const result = CourseTemplate.parse("wheel", wheel);

    expect(result.ok && result.value.workshop).toEqual({
      formats: ["Standard", "Glazing", "Open Studio", "Beginner"],
      defaultDurationMinutes: 180,
      defaultCapacity: 16,
      minPotters: 4,
    });
  });

  it("rejects a default capacity above the studio's 30 spots", () => {
    expect(error(withWorkshop({ defaultCapacity: 32 }))).toBe(
      "courses/wheel.json: defaultCapacity must be between minPotters and 30.",
    );
  });

  it("rejects a minimum potter count above the default capacity", () => {
    expect(error(withWorkshop({ minPotters: 20 }))).toBe(
      "courses/wheel.json: defaultCapacity must be between minPotters and 30.",
    );
  });

  it("rejects a template that offers no formats", () => {
    expect(error(withWorkshop({ formats: [] }))).toBe("courses/wheel.json: formats must list at least one format.");
  });

  it("rejects a default duration that is not a whole number of half hours", () => {
    expect(error(withWorkshop({ defaultDurationMinutes: 100 }))).toBe(
      "courses/wheel.json: defaultDurationMinutes must be 60 to 480 in steps of 30.",
    );
  });

  it("rejects a color that could break out of the generated courses.css rule", () => {
    const hostile = { ...wheel, content: { ...wheel.content, color: "#5B2A86; } body { display: none" } };

    expect(error(hostile)).toBe("courses/wheel.json: color must be a six-digit hex color such as #5B2A86.");
  });
});
