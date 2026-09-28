import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import type { BookingView } from "../bookings/booking-view";
import { formatDay, formatTime } from "../time/format";

type Props = {
  booking: BookingView;
  workshopUrl: string;
};

export const BookingConfirmedPage: FC<Props> = ({ booking, workshopUrl }) => {
  const { workshop } = booking;
  const day = formatDay(workshop.startsAt);
  const start = formatTime(workshop.startsAt);

  return (
    <Layout title="Booking Confirmation">
      <section class="confirmed" aria-labelledby="confirmed-heading">
        <h1 id="confirmed-heading">Awesome, you're in!</h1>
        <p>Your booking has been submitted.</p>

        <dl class="confirmed__facts">
          <dt>Workshop</dt>
          <dd>{workshop.name}</dd>
          <dt>When</dt>
          <dd>
            {day} at {start}
          </dd>
          <dt>Your spot</dt>
          <dd>
            Spot {booking.spot} of {workshop.capacity}
          </dd>
        </dl>

        <p>Get to the studio 15 minutes early so the organizer can spot you.</p>
        <p class="hint">Confirmation UUID: {booking.id}</p>

        <div class="confirmed__actions">
          <a class="button" href={`/workshops/${workshop.id}/invite.ics`} download>
            Add to calendar
          </a>
          <a href={`/workshops/${workshop.id}`}>Back to the workshop</a>
        </div>

        <p class="confirmed__share">Know someone who wants to play? Send them this link:</p>
        <p class="confirmed__link">
          <a href={workshopUrl}>{workshopUrl}</a>
        </p>
        <p class="confirmed__hype">Get ready for an epic night of card battles!</p>
      </section>
    </Layout>
  );
};
