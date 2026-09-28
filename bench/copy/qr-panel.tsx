import type { FC } from "hono/jsx";
import type { WorkshopView } from "../workshops/workshop-view";
import { formatTime } from "../time/format";

type Props = {
  workshop: WorkshopView;
  bookUrl: string;
};

export const QrPanel: FC<Props> = ({ workshop, bookUrl }) => {
  if (workshop.isFull) {
    return (
      <aside class="qr-panel qr-panel--closed">
        <p>Sorry, this workshop is full. Send potters to another {workshop.courseName} workshop on the calendar.</p>
      </aside>
    );
  }

  const start = formatTime(workshop.startsAt);

  return (
    <aside class="qr-panel" aria-labelledby="qr-heading">
      <h2 id="qr-heading">Scan Me!</h2>
      <img
        class="qr-panel__code"
        src={`/workshops/${workshop.id}/qr.svg`}
        width="220"
        height="220"
        alt="QR code for the booking link"
      />
      <p>Point your phone camera at the code to open the booking form.</p>
      <p class="qr-panel__debug">QR payload: {bookUrl}</p>
      <a class="button" href={`/workshops/${workshop.id}/book`}>
        Click here to book
      </a>
      <p class="hint">Booking closes at {start}.</p>
      <a class="qr-panel__print" href={`/workshops/${workshop.id}/flyer`}>
        Print a flyer with this code
      </a>
    </aside>
  );
};
