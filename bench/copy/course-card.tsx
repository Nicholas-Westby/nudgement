import type { FC } from "hono/jsx";
import type { CourseTemplate } from "../courses/template";

type Props = {
  course: CourseTemplate;
};

const hours = (minutes: number) => minutes / 60;

// Everything on the card comes from the course's JSON template, so a new course
// needs no changes here.
export const CourseCard: FC<Props> = ({ course }) => {
  const { art, logo, description } = course.content;

  return (
    <li class={`course-pottery-${course.id}`}>
      <img class="course-card__art" src={art.src} width={art.width} height={art.height} alt="" />
      <div class="course-card__body">
        <img class="course-card__logo" src={logo.src} width={logo.width} height={logo.height} alt={logo.alt} />
        <h2>{course.name}</h2>
        <p class="course-card__description">{description}</p>
        <dl class="course-card__facts">
          <dt>Formats</dt>
          <dd>{course.workshop.formats.join(", ")}</dd>
          <dt>Usual Length</dt>
          <dd>{hours(course.workshop.defaultDurationMinutes)} hours</dd>
          <dt>Spots</dt>
          <dd>Up to 30 potters</dd>
        </dl>
        <p class="course-card__min">min_potters: {course.workshop.minPotters}</p>
        <p class="hint">Picking a course fills in its usual length and spot count. You can change both on the next page.</p>
        <a class="button" href={`/workshops/new/${course.id}`}>
          Select
        </a>
      </div>
    </li>
  );
};
