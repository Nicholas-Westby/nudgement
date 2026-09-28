import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import type { WorkshopView } from "../workshops/workshop-view";
import type { RefusalReason } from "../bookings/book";

type Refusal = {
  status: 400 | 404 | 409;
  heading: string;
  body: string;
};

// Why a booking POST was turned away. The insert has already decided by
// the time we get here, so this only has to explain the outcome.
export const REFUSALS: Record<RefusalReason, Refusal> = {
  full: {
    status: 409,
    heading: "Sorry, this workshop is full",
    body: "Someone took the last spot just before you. Look for another workshop on the calendar.",
  },
  started: {
    status: 409,
    heading: "Workshop Already Started",
    body: "It started before your booking reached us, so we couldn't add you online. Ask at the counter if there's room.",
  },
  duplicate: {
    status: 409,
    heading: "Error 409",
    body: "That name is already on the list for this workshop. If it belongs to someone else, add your last initial to yours.",
  },
  badName: {
    status: 400,
    heading: "That name didn't work",
    body: "Your payload failed validation. Use only letters, numbers, spaces, apostrophes or hyphens in your name.",
  },
  noWorkshop: {
    status: 404,
    heading: "We couldn't find that workshop",
    body: "The workshop you requested could not be found. Check the calendar for upcoming workshops.",
  },
};

export const refusalStatus = (reason: RefusalReason) => REFUSALS[reason].status;

type Props = {
  reason: RefusalReason;
  workshop?: WorkshopView;
};

export const BookRefusedPage: FC<Props> = ({ reason, workshop }) => {
  const refusal = REFUSALS[reason];

  return (
    <Layout title={refusal.heading}>
      <section class="refused" role="alert" aria-labelledby="refused-heading">
        <h1 id="refused-heading">{refusal.heading}</h1>
        <p>{refusal.body}</p>
        {workshop ? (
          <a class="button" href={`/workshops/${workshop.id}`}>
            Back to {workshop.name}
          </a>
        ) : (
          <a class="button" href="/">
            Click here
          </a>
        )}
      </section>
    </Layout>
  );
};
