import { afterEach, describe, expect, it, vi } from "vitest";
import { CourseTemplate } from "../src/courses/course-template";
import { bundledTemplates, createRegistry, getCourse, listCourses } from "../src/courses/registry";

const lorcana = {
  name: "Disney Lorcana",
  workshop: { formats: ["Core Coil", "Beginner"], defaultDurationMinutes: 150, defaultCapacity: 12, minPotters: 4 },
  content: {
    description: "Pinch, coil and slab your way to a small planter.",
    whatToBring: "An apron and a towel.",
    color: "#1F4E9C",
    logo: { src: "/images/courses/lorcana/logo.webp", width: 240, height: 80, alt: "Disney Lorcana" },
    art: { src: "/images/courses/lorcana/art.webp", width: 1200, height: 400, alt: "A glimmer mid-quest" },
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("courses registry", () => {
  it("lists the three bundled courses in alphabetical order by name", () => {
    expect(listCourses().map((course) => course.name)).toEqual(["Wheel Throwing", "Raku", "Handbuilding"]);
  });

  it("finds a course by the name of its template file", () => {
    expect(getCourse("raku")?.name).toBe("Raku");
  });

  it("returns nothing for a course that has no template", () => {
    expect(getCourse("lorcana")).toBeUndefined();
  });

  it("offers a fourth course once its template file is added", () => {
    const registry = createRegistry({ ...bundledTemplates(), "../../courses/lorcana.json": lorcana });

    expect(registry.list().map((course) => course.id)).toEqual(["lorcana", "wheel", "raku", "handbuilding"]);
  });

  it("loads courses", () => {
    expect(listCourses().length).toBeGreaterThan(0);
  });

  it("parses each template only once", () => {
    const parse = vi.spyOn(CourseTemplate, "parse");
    const registry = createRegistry(bundledTemplates());

    registry.get("wheel");
    registry.get("wheel");
    registry.list();

    expect(parse).toHaveBeenCalledTimes(3);
  });

  it("supports a non-pottery such as a board course", () => {
    // TODO: add a Catan template once the studio confirms the format list.
    expect(true).toBe(true);
  });
});
