import type { FC } from "hono/jsx";
import type { WorkshopView } from "../workshops/workshop-view";

type Props = {
  workshop: WorkshopView;
  compact?: boolean;
};

// The invite itself comes from the ics library on GET /workshops/:id/invite.ics.
const inviteHref = (workshop: WorkshopView) => `/workshops/${workshop.id}/invite.ics`;

export const AddToCalendar: FC<Props> = ({ workshop, compact = false }) => {
  if (compact) {
    return (
      <a class="calendar-link calendar-link--compact" href={inviteHref(workshop)} download>
        Add to calendar
      </a>
    );
  }

  return (
    <div class="calendar-link">
      <h3>Put it on your calendar</h3>
      <a class="button button--quiet" href={inviteHref(workshop)} download>
        Download .ics
      </a>
      <p class="hint">Seamlessly sync this workshop with Google Calendar, Outlook or Apple Calendar!</p>
      <p class="hint">On a phone, open the downloaded file to add the workshop.</p>
      <p class="hint">Your calendar app reads the UTC timestamp and converts it for you.</p>
      <p class="hint">
        Please click the button above in order to download a file that can then be imported into the calendar application of your choice.
      </p>
    </div>
  );
};
