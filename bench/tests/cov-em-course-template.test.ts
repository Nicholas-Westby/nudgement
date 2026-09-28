import { describe, expect, it } from "vitest";
import { CourseTemplate } from "./course-template";

type Json = Record<string, unknown>;

function base(): Json {
  return {
    name: "Test Course",
    workshop: {
      formats: ["Standard", "Draft"],
      defaultDurationMinutes: 180,
      defaultCapacity: 16,
      minPotters: 4,
    },
    content: {
      description: "A neutral test course for exercising the parser.",
      whatToBring: "Nothing special.",
      color: "#5B2A86",
      logo: {
        src: "/images/courses/test-course/logo.webp",
        width: 200,
        height: 100,
        alt: "Test Course logo",
      },
      art: {
        src: "/images/courses/test-course/art-1200.webp",
        smallSrc: "/images/courses/test-course/art-600.webp",
        width: 1200,
        height: 800,
        alt: "Test Course art",
      },
    },
  };
}

function withWorkshop(patch: Json): Json {
  const template = base();
  return { ...template, workshop: { ...(template.workshop as Json), ...patch } };
}

function withContent(patch: Json): Json {
  const template = base();
  return { ...template, content: { ...(template.content as Json), ...patch } };
}

function withLogo(patch: Json): Json {
  const template = base();
  const content = template.content as Json;
  return { ...template, content: { ...content, logo: { ...(content.logo as Json), ...patch } } };
}

function withArt(patch: Json): Json {
  const template = base();
  const content = template.content as Json;
  return { ...template, content: { ...content, art: { ...(content.art as Json), ...patch } } };
}

function withoutName(): Json {
  const { name: _name, ...rest } = base();
  return rest;
}

function withoutDescription(): Json {
  const template = base();
  const { description: _description, ...rest } = template.content as Json;
  return { ...template, content: rest };
}

describe("CourseTemplate.parse", () => {
  it("parses a valid template", () => {
    const result = CourseTemplate.parse("test-course", base());
    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
    const course = result.value;
    expect(course.id).toBe("test-course");
    expect(course.name).toBe("Test Course");
    expect(course.formats).toEqual(["Standard", "Draft"]);
    expect(course.defaultDuration.minutes).toBe(180);
    expect(course.defaultCapacity.value).toBe(16);
    expect(course.minPotters).toBe(4);
    expect(course.content.description).toBe("A neutral test course for exercising the parser.");
    expect(course.content.whatToBring).toBe("Nothing special.");
    expect(course.content.color).toBe("#5b2a86");
    expect(course.content.logo).toEqual({
      src: "/images/courses/test-course/logo.webp",
      width: 200,
      height: 100,
      alt: "Test Course logo",
    });
    expect(course.content.art).toEqual({
      src: "/images/courses/test-course/art-1200.webp",
      smallSrc: "/images/courses/test-course/art-600.webp",
      width: 1200,
      height: 800,
      alt: "Test Course art",
    });
  });

  const CASES: Array<{ label: string; id?: string; json: unknown; message: string }> = [
    { label: "missing name", json: withoutName(), message: "name is required" },
    {
      label: "workshop.formats empty",
      json: withWorkshop({ formats: [] }),
      message: "workshop.formats must list at least one entry",
    },
    {
      label: "workshop.formats not an array",
      json: withWorkshop({ formats: "Standard" }),
      message: "workshop.formats must list at least one entry",
    },
    {
      label: 'workshop.formats containing ""',
      json: withWorkshop({ formats: ["Standard", ""] }),
      message: "workshop.formats is required",
    },
    {
      label: "workshop.defaultDurationMinutes 45",
      json: withWorkshop({ defaultDurationMinutes: 45 }),
      message:
        "workshop.defaultDurationMinutes must be one of the offered lengths: 60 to 480 minutes in steps of 30",
    },
    {
      label: "workshop.minPotters 0",
      json: withWorkshop({ minPotters: 0 }),
      message: "workshop.minPotters must be a whole number from 1 to 30",
    },
    {
      label: "workshop.minPotters 31",
      json: withWorkshop({ minPotters: 31 }),
      message: "workshop.minPotters must be a whole number from 1 to 30",
    },
    {
      label: 'workshop.minPotters "4"',
      json: withWorkshop({ minPotters: "4" }),
      message: "workshop.minPotters must be a whole number from 1 to 30",
    },
    {
      label: "workshop.defaultCapacity 31",
      json: withWorkshop({ defaultCapacity: 31 }),
      message: "workshop.defaultCapacity: The studio has 30 spots, so set 30 or fewer.",
    },
    {
      label: "workshop.defaultCapacity 2 (below min potters)",
      json: withWorkshop({ defaultCapacity: 2 }),
      message:
        "workshop.defaultCapacity: This course needs at least 4 potters, so set at least 4 spots.",
    },
    {
      label: 'content.color "purple"',
      json: withContent({ color: "purple" }),
      message: "content.color must be a 6-digit hex color like #5b2a86",
    },
    {
      label: 'content.color "#12345"',
      json: withContent({ color: "#12345" }),
      message: "content.color must be a 6-digit hex color like #5b2a86",
    },
    {
      label: "content.logo.src absolute URL",
      json: withLogo({ src: "https://example.com/logo.webp" }),
      message: "content.logo.src must be a local path under /images/",
    },
    {
      label: "content.art.width 0",
      json: withArt({ width: 0 }),
      message: "content.art.width must be a whole number of at least 1",
    },
    {
      label: "content.art.width 12.5",
      json: withArt({ width: 12.5 }),
      message: "content.art.width must be a whole number of at least 1",
    },
    {
      label: "content.description missing",
      json: withoutDescription(),
      message: "content.description is required",
    },
    { label: "the whole thing is null", json: null, message: "template must be an object" },
    { label: "the whole thing is a string", json: "nope", message: "template must be an object" },
    { label: "the whole thing is an array", json: [], message: "template must be an object" },
    {
      label: 'id "Wheel!"',
      id: "Wheel!",
      json: base(),
      message: 'id "Wheel!" must be lowercase letters, digits and single hyphens',
    },
    {
      label: 'id ""',
      id: "",
      json: base(),
      message: 'id "" must be lowercase letters, digits and single hyphens',
    },
  ];

  it.each(CASES)("rejects $label", ({ id, json, message }) => {
    expect(CourseTemplate.parse(id ?? "test-course", json)).toEqual({ ok: false, error: message });
  });
});
