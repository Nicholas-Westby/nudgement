import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { courseStylesheet } from "./course-styles";
import { CourseTemplate } from "./course-template";
import { courses } from "./courses";

function template(id: string, color: string): CourseTemplate {
  const parsed = CourseTemplate.parse(id, {
    name: `Fixture ${id}`,
    workshop: {
      formats: ["Standard"],
      defaultDurationMinutes: 120,
      defaultCapacity: 8,
      minPotters: 2,
    },
    content: {
      description: "A fixture course used only in tests.",
      whatToBring: "Nothing special.",
      color,
      logo: { src: "/images/courses/fixture/logo.webp", width: 100, height: 50, alt: id },
      art: {
        src: "/images/courses/fixture/art-1200.webp",
        smallSrc: "/images/courses/fixture/art-600.webp",
        width: 1200,
        height: 800,
        alt: id,
      },
    },
  });
  if (!parsed.ok) throw new Error(`fixture template is invalid: ${parsed.error}`);
  return parsed.value;
}

describe("courseStylesheet", () => {
  it("renders one custom-property rule per course", () => {
    const css = courseStylesheet([template("a", "#111111"), template("b", "#222222")]);
    expect(css).toBe(".course-a { --course-color: #111111; }\n.course-b { --course-color: #222222; }\n");
  });

  it("renders nothing for an empty list", () => {
    expect(courseStylesheet([])).toBe("");
  });

  it("preserves the order given instead of re-sorting", () => {
    const css = courseStylesheet([template("z", "#111111"), template("a", "#222222")]);
    expect(css).toBe(".course-z { --course-color: #111111; }\n.course-a { --course-color: #222222; }\n");
  });
});

describe("GET /courses.css", () => {
  const app = createApp({ now: () => Temporal.Instant.from("2026-09-26T19:00:00Z") });

  it("serves a stylesheet with a rule for every shipped course", async () => {
    const response = await app.request("/courses.css");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/css/);
    const body = await response.text();
    for (const course of courses) {
      expect(body).toContain(`.course-${course.id} {`);
    }
  });
});
