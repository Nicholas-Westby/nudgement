import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import type { CalendarDay, CalendarWorkshop } from "../calendar/month-grid";
import type { YearMonth } from "../values/year-month";
import { formatTime } from "../time/format";

type Props = {
  month: YearMonth;
  weeks: CalendarDay[][];
  isCurrentMonth: boolean;
};

const WEEKDAYS = [
  { short: "Sun", long: "Sunday" },
  { short: "Mon", long: "Monday" },
  { short: "Tue", long: "Tuesday" },
  { short: "Wed", long: "Wednesday" },
  { short: "Thu", long: "Thursday" },
  { short: "Fri", long: "Friday" },
  { short: "Sat", long: "Saturday" },
];

const WorkshopChip: FC<{ workshop: CalendarWorkshop }> = ({ workshop }) => (
  <li class={`chip course-${workshop.courseId}`}>
    <a class="chip__link" href={`/workshops/${workshop.id}`}>
      <span class="chip__time">{formatTime(workshop.startsAt)}</span>
      <span class="chip__name">{workshop.name}</span>
      {workshop.isFull ? (
        <span class="chip__spots chip__spots--full">Full</span>
      ) : (
        <span class="chip__spots">
          {workshop.spotsLeft} of {workshop.capacity} spots left
        </span>
      )}
    </a>
  </li>
);

const DayCell: FC<{ day: CalendarDay }> = ({ day }) => (
  <td class={day.inMonth ? "day" : "day day--outside"} aria-current={day.isToday ? "date" : undefined}>
    <span class="day__number">{day.date.day}</span>
    {day.isToday && <span class="visually-hidden">Today</span>}
    {day.workshops.length > 0 && (
      <ul class="day__workshops">
        {day.workshops.map((workshop) => (
          <WorkshopChip workshop={workshop} />
        ))}
      </ul>
    )}
  </td>
);

export const CalendarMonthPage: FC<Props> = ({ month, weeks, isCurrentMonth }) => {
  const hasWorkshops = weeks.some((week) => week.some((day) => day.inMonth && day.workshops.length > 0));

  return (
    <Layout title={`${month.label} workshops`}>
      <header class="month-header">
        <h1>{month.label}</h1>
        <nav class="month-nav" aria-label="Other months">
          <a href={`/calendar/${month.previous().key}`}>Previous month</a>
          {!isCurrentMonth && <a href="/">This month</a>}
          <a href={`/calendar/${month.next().key}`}>Next month</a>
        </nav>
      </header>

      <p class="month-note">Times are Vancouver time. Pick a workshop to see its details and book.</p>

      {!hasWorkshops && (
        <div class="empty">
          <p>No workshops are on the calendar for {month.label} yet.</p>
          <a class="button" href="/workshops/new">
            Create a workshop
          </a>
        </div>
      )}

      <table class="month-grid">
        <caption class="visually-hidden">Workshops in {month.label}</caption>
        <thead>
          <tr>
            {WEEKDAYS.map((weekday) => (
              <th scope="col" abbr={weekday.long}>
                {weekday.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr>
              {week.map((day) => (
                <DayCell day={day} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
};
