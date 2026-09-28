import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import type { WorkshopView } from "../workshops/workshop-view";
import type { CourseTemplate } from "../courses/template";
import { formatDay, formatTime, monthOf } from "../time/format";

type Props = {
  workshop: WorkshopView;
  course: CourseTemplate;
  bookUrl: string;
};

const SpotLine: FC<{ potter?: string }> = ({ potter }) =>
  potter ? (
    <li class="sheet__line">{potter}</li>
  ) : (
    <li class="sheet__line sheet__line--open">
      <span class="visually-hidden">Open spot</span>
    </li>
  );

export const WorkshopPage: FC<Props> = ({ workshop, course, bookUrl }) => {
  const day = formatDay(workshop.startsAt);
  const start = formatTime(workshop.startsAt);
  const end = formatTime(workshop.endsAt);
  const month = monthOf(workshop.startsAt);
  const open = !workshop.isFull && !workshop.hasStarted;
  const spots = Array.from({ length: workshop.capacity }, (_, index) => workshop.potters[index]);
  const { art, logo } = course.content;

  return (
    <Layout title={workshop.name} path={`/workshops/${workshop.id}`}>
      <a class="back-link" href={`/calendar/${month.key}`}>
        Back to the {month.label} calendar
      </a>

      <article class={`workshop course-${workshop.courseId}`}>
        <img class="workshop__art" src={art.src} width={art.width} height={art.height} alt="" />
        <header class="workshop__header">
          <img class="workshop__logo" src={logo.src} width={logo.width} height={logo.height} alt={logo.alt} />
          <h1>{workshop.name}</h1>
          <p class="workshop__course">
            {workshop.courseName}, {workshop.format}
          </p>
        </header>

        <dl class="workshop__facts">
          <dt>When</dt>
          <dd>
            {day}, {start} to {end} Vancouver time
          </dd>
          <dt>Where</dt>
          <dd>Claybank Studio, 48 Harbour Road, Victoria</dd>
          <dt>Spots</dt>
          <dd>
            {workshop.spotsLeft} of {workshop.capacity} spots left
          </dd>
          <dt>Minimum potters</dt>
          <dd>The workshop runs if at least {workshop.minPotters} potters book.</dd>
        </dl>

        <p class="workshop__calendar">
          <a class="button button--quiet" href={`/workshops/${workshop.id}/invite.ics`} download>
            Add to calendar
          </a>
          <span class="hint">Works with Google Calendar, Outlook and Apple Calendar.</span>
        </p>

        <section class="workshop__bring" aria-labelledby="bring-heading">
          <h2 id="bring-heading">What to bring</h2>
          <p>{course.content.whatToBring}</p>
        </section>
      </article>

      <div class="workshop__signup">
        <section class="sheet" aria-labelledby="sheet-heading">
          <h2 id="sheet-heading">Who's playing</h2>
          {workshop.isFull && <p class="stamp">Full</p>}
          <ol class="sheet__lines">
            {spots.map((potter) => (
              <SpotLine potter={potter} />
            ))}
          </ol>
          {workshop.potters.length === 0 && <p class="hint">Nobody has booked yet.</p>}
        </section>

        <section class="book-panel" aria-labelledby="book-heading">
          <h2 id="book-heading">Booking</h2>
          {open && (
            <>
              <img
                class="book-panel__qr"
                src={`/workshops/${workshop.id}/qr.svg`}
                width="200"
                height="200"
                alt="QR code that opens the booking form for this workshop"
              />
              <p>Scan the code with your phone camera, or open this link:</p>
              <p class="book-panel__link">
                <a href={bookUrl}>{bookUrl}</a>
              </p>
              <a class="button" href={`/workshops/${workshop.id}/book`}>
                Book for this workshop
              </a>
              <p class="hint">Booking closes when the workshop starts.</p>
            </>
          )}
          {workshop.isFull && <p>This workshop is full. Check the calendar for another {workshop.courseName} workshop.</p>}
          {!workshop.isFull && workshop.hasStarted && (
            <p>Booking closed when the workshop started. If you're at the studio, ask at the counter.</p>
          )}
        </section>
      </div>
    </Layout>
  );
};
