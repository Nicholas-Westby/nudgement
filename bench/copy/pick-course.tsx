import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import type { CourseTemplate } from "../courses/template";

type Props = {
  courses: CourseTemplate[];
};

const hours = (minutes: number) => {
  const value = minutes / 60;
  return value === 1 ? "1 hour" : `${value} hours`;
};

const CourseChoice: FC<{ course: CourseTemplate }> = ({ course }) => {
  const { art, logo } = course.content;

  return (
    <li class={`course-choice course-${course.id}`}>
      <img class="course-choice__art" src={art.src} width={art.width} height={art.height} alt="" />
      <img class="course-choice__logo" src={logo.src} width={logo.width} height={logo.height} alt={logo.alt} />
      <h2>{course.name}</h2>
      <dl class="course-choice__facts">
        <dt>Formats</dt>
        <dd>{course.workshop.formats.join(", ")}</dd>
        <dt>Usual length</dt>
        <dd>{hours(course.workshop.defaultDurationMinutes)}</dd>
        <dt>Potters</dt>
        <dd>{course.workshop.minPotters} to 30</dd>
      </dl>
      <a class="button" href={`/workshops/new/${course.id}`}>
        Create a {course.name} workshop
      </a>
    </li>
  );
};

export const PickCoursePage: FC<Props> = ({ courses }) => (
  <Layout title="Create a workshop" path="/workshops/new">
    <h1>Which course is the workshop for?</h1>
    <p class="lede">
      Each course has its own formats, usual length and potter limits. You can change the length and spots on the next page.
    </p>
    <ul class="course-choices">
      {courses.map((course) => (
        <CourseChoice course={course} />
      ))}
    </ul>
    <p class="hint">Don't see your course? Ask the studio owner to add it.</p>
  </Layout>
);
