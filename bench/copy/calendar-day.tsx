import type { FC } from "hono/jsx";
import type { CalendarDay, CalendarWorkshop } from "../calendar/month-grid";
import { formatDay, formatTime } from "../time/format";

// A cell shows three workshops at most; the rest are one link away.
const MAX_CHIPS = 3;
const NEW_FOR_MS = 24 * 60 * 60 * 1000;

type Props = {
  day: CalendarDay;
  now: Temporal.Instant;
};

type ChipProps = {
  workshop: CalendarWorkshop;
  now: Temporal.Instant;
};

const isNew = (workshop: CalendarWorkshop, now: Temporal.Instant) =>
  now.epochMilliseconds - workshop.createdAt.epochMilliseconds < NEW_FOR_MS;

const Chip: FC<ChipProps> = ({ workshop, now }) => (
  <li class={`chip course-${workshop.courseId}`}>
    <a class="chip__link" href={`/workshops/${workshop.id}`}>
      {isNew(workshop, now) && <span class="chip__badge">NEW</span>}
      <span class="chip__name">{workshop.name}</span>
      <span class="chip__time">Starts {formatTime(workshop.startsAt)}</span>
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

export const CalendarDayCell: FC<Props> = ({ day, now }) => {
  const shown = day.workshops.slice(0, MAX_CHIPS);
  const hidden = day.workshops.length - shown.length;
  const label = formatDay(day.date);

  return (
    <td class={day.inMonth ? "day" : "day day--outside"} aria-current={day.isToday ? "date" : undefined}>
      <span class="day__number">{day.date.day}</span>
      {day.isToday && <span class="day__today">Today</span>}
      {shown.length > 0 && (
        <ul class="day__workshops" aria-label={label}>
          {shown.map((workshop) => (
            <Chip workshop={workshop} now={now} />
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <a class="day__more" href={`#day-${day.key}`}>
          See all {day.workshops.length} workshops on {label}
        </a>
      )}
    </td>
  );
};
