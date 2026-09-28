import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import type { WorkshopView } from "../workshops/workshop-view";
import type { CourseTemplate } from "../courses/template";
import { formatDay, formatTime } from "../time/format";

type Props = {
  workshop: WorkshopView;
  course: CourseTemplate;
  bookUrl: string;
};

// A print stylesheet hides .screen-only and sizes .flyer to one letter page.
export const WorkshopFlyerPage: FC<Props> = ({ workshop, course, bookUrl }) => {
  const day = formatDay(workshop.startsAt);
  const start = formatTime(workshop.startsAt);
  const end = formatTime(workshop.endsAt);
  const { logo } = course.content;

  return (
    <Layout title="Print a flyer" path={`/workshops/${workshop.id}/flyer`}>
      <div class="flyer-instructions screen-only">
        <p>Print this page from your browser and post it by the counter.</p>
        <a href={`/workshops/${workshop.id}`}>Back to the workshop page</a>
      </div>

      <article class={`flyer course-${workshop.courseId}`}>
        <p class="flyer__tagline">DON'T MISS OUT!</p>
        <img class="flyer__logo" src={logo.src} width={logo.width} height={logo.height} alt={logo.alt} />
        <h1 class="flyer__name">{workshop.name}</h1>
        <p class="flyer__pitch">The ultimate {workshop.courseName} showdown is coming to Claybank Studio!</p>

        <dl class="flyer__facts">
          <dt>When</dt>
          <dd>
            {day}, {start} to {end}
          </dd>
          <dt>Format</dt>
          <dd>{workshop.format}</dd>
          <dt>Spots</dt>
          <dd>{workshop.capacity} potters</dd>
        </dl>

        <section class="flyer__bring" aria-labelledby="flyer-bring-heading">
          <h2 id="flyer-bring-heading">What to bring</h2>
          <p>{course.content.whatToBring}</p>
        </section>

        <figure class="flyer__qr">
          <img
            src={`/workshops/${workshop.id}/qr.svg`}
            width="320"
            height="320"
            alt="QR code that opens the booking form"
          />
          <figcaption>SCAN TO BOOK</figcaption>
        </figure>
        <p class="flyer__link">Or type this link: {bookUrl}</p>
        <p class="flyer__address">Claybank Studio, 48 Harbour Road, Victoria</p>
      </article>
    </Layout>
  );
};
