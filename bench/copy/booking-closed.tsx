import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import type { WorkshopView } from "../workshops/workshop-view";
import { formatDay, formatTime } from "../time/format";

export type ClosedReason = "full" | "started";

type Props = {
  workshop: WorkshopView;
  reason: ClosedReason;
  calendarHref: string;
};

// Shown instead of the form when someone opens the booking link late.
const Full: FC<Props> = ({ workshop, calendarHref }) => (
  <section class="closed" aria-labelledby="closed-heading">
    <p class="stamp" aria-hidden="true">
      Full
    </p>
    <h1 id="closed-heading">{workshop.name} is full</h1>
    <p>
      There are no spots left. Look for another {workshop.courseName} workshop on the calendar, or ask at the counter in case someone drops out.
    </p>
    <a class="button" href={calendarHref}>
      Find another workshop
    </a>
  </section>
);

const Started: FC<Props> = ({ workshop, calendarHref }) => {
  const day = formatDay(workshop.startsAt);
  const start = formatTime(workshop.startsAt);

  return (
    <section class="closed" aria-labelledby="closed-heading">
      <h1 id="closed-heading">Booking for {workshop.name} has closed</h1>
      <p>
        The workshop started on {day} at {start} Vancouver time. Online booking ends when a workshop starts.
      </p>
      <p>If you're at the studio, ask at the counter whether there's still room.</p>
      <a class="button" href={calendarHref}>
        See upcoming workshops
      </a>
    </section>
  );
};

export const BookingClosedPage: FC<Props> = (props) => (
  <Layout title={props.reason === "full" ? "Workshop full" : "Booking has closed"}>
    {props.reason === "full" ? <Full {...props} /> : <Started {...props} />}
    <p class="closed__back">
      <a href={`/workshops/${props.workshop.id}`}>Back to the workshop page</a>
    </p>
  </Layout>
);
