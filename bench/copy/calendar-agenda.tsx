import type { FC } from "hono/jsx";
import type { AgendaDay, CalendarWorkshop } from "../calendar/agenda";
import type { YearMonth } from "../values/year-month";
import { formatDay, formatTime } from "../time/format";

type Props = {
  month: YearMonth;
  days: AgendaDay[];
};

// The small-screen version of the month: only the days that have workshops.
const AgendaItem: FC<{ workshop: CalendarWorkshop }> = ({ workshop }) => {
  const start = formatTime(workshop.startsAt);

  return (
    <li class={`agenda__item course-${workshop.courseId}`}>
      <p class="agenda__name">{workshop.name}</p>
      <p class="agenda__meta">
        {workshop.courseName}, {workshop.format}
      </p>
      <p class="agenda__time">Starts at {start}</p>
      {workshop.isFull ? (
        <p class="agenda__spots agenda__spots--full">Full</p>
      ) : (
        <p class="agenda__spots">{workshop.spotsLeft} spots left</p>
      )}
      {workshop.pottersNeeded > 0 && <p class="agenda__needs">Needs {workshop.pottersNeeded} more potters to run</p>}
      <a class="agenda__link" href={`/workshops/${workshop.id}`}>
        View
      </a>
    </li>
  );
};

export const CalendarAgenda: FC<Props> = ({ month, days }) => (
  <section class="agenda" aria-labelledby="agenda-heading">
    <h2 id="agenda-heading">Upcoming Workshops</h2>
    {days.length === 0 ? (
      <div class="agenda__empty">
        <p>
          At this point in time there are currently no upcoming workshops that have been scheduled for this month. Please check back again at a later date.
        </p>
        <a class="button" href="/workshops/new">
          Create a workshop
        </a>
      </div>
    ) : (
      days.map((day) => (
        <section class="agenda__day" aria-labelledby={`day-${day.key}`}>
          <h3 id={`day-${day.key}`}>{formatDay(day.date)}</h3>
          <ul class="agenda__items">
            {day.workshops.map((workshop) => (
              <AgendaItem workshop={workshop} />
            ))}
          </ul>
        </section>
      ))
    )}
    <a class="agenda__next" href={`/calendar/${month.next().key}`}>
      See {month.next().label}
    </a>
  </section>
);
