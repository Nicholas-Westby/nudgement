import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findCourse, courses } from "./courses";
import { loadCourses } from "./load-courses";

function validTemplate(name: string): unknown {
  return {
    name,
    workshop: {
      formats: ["Standard"],
      defaultDurationMinutes: 120,
      defaultCapacity: 8,
      minPotters: 2,
    },
    content: {
      description: "A fixture course used only in tests.",
      whatToBring: "Nothing special.",
      color: "#123456",
      logo: { src: "/images/courses/fixture/logo.webp", width: 100, height: 50, alt: name },
      art: {
        src: "/images/courses/fixture/art-1200.webp",
        smallSrc: "/images/courses/fixture/art-600.webp",
        width: 1200,
        height: 800,
        alt: name,
      },
    },
  };
}

describe("loadCourses", () => {
  const loaded = loadCourses({
    "../../courses/b.json": validTemplate("Zeta Course"),
    "../../courses/a.json": validTemplate("Alpha Course"),
  });

  it("takes each course's id from its file name, not the glob key path", () => {
    expect(loaded.map((course) => course.id).toSorted()).toEqual(["a", "b"]);
  });

  it("sorts the loaded courses by name", () => {
    expect(loaded.map((course) => course.name)).toEqual(["Alpha Course", "Zeta Course"]);
  });

  it("throws one error naming every broken file", () => {
    expect(() => loadCourses({ "../../courses/x.json": {}, "../../courses/y.json": {} })).toThrowError(
      /courses\/x\.json: name is required[\s\S]*courses\/y\.json: name is required/,
    );
  });
});

describe("the real course templates", () => {
  it("has exactly the three shipped courses", () => {
    expect(courses.length).toBe(3);
  });

  it("points every image field at a file that exists under public/", () => {
    for (const course of courses) {
      for (const src of [course.content.logo.src, course.content.art.src, course.content.art.smallSrc]) {
        expect(existsSync(join("public", src)), src).toBe(true);
      }
    }
  });

  it("finds a course by id", () => {
    const first = courses[0];
    if (!first) throw new Error("expected at least one course");
    expect(findCourse(first.id)).toBe(first);
  });

  it("returns undefined for an unknown id", () => {
    expect(findCourse("nope")).toBeUndefined();
  });
});
