import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import type { WorkshopView } from "../workshops/workshop-view";
import { formatDay, formatTime } from "../time/format";

// PotterName.parse reports one of these; the page turns it into a sentence.
export const NAME_ERRORS = {
  empty: "Enter your name to book.",
  tooLong: "That name is longer than 50 characters. Shorten it, or use a first name and last initial.",
} as const;

export type NameError = keyof typeof NAME_ERRORS;

type Props = {
  workshop: WorkshopView;
  name?: string;
  error?: NameError;
};

export const BookPage: FC<Props> = ({ workshop, name = "", error }) => {
  const day = formatDay(workshop.startsAt);
  const start = formatTime(workshop.startsAt);
  const describedBy = error ? "name-hint name-error" : "name-hint";

  return (
    <Layout title="Book for a workshop" path={`/workshops/${workshop.id}/book`}>
      <article class={`book course-${workshop.courseId}`}>
        <p class="book__course">
          {workshop.courseName}, {workshop.format}
        </p>
        <h1>{workshop.name}</h1>
        <p class="book__when">
          {day} at {start} Vancouver time
        </p>
        <p class="book__spots">
          {workshop.spotsLeft} of {workshop.capacity} spots left
        </p>

        <form class="book__form" method="post" action={`/workshops/${workshop.id}/book`} novalidate>
          <label for="potter-name">Your name</label>
          <p id="name-hint" class="hint">
            Use the name the organizer will call at the table. Other potters see it on the sign-up sheet.
          </p>
          {error && (
            <p id="name-error" class="field-error">
              {NAME_ERRORS[error]}
            </p>
          )}
          <input
            id="potter-name"
            name="name"
            type="text"
            autocomplete="name"
            maxlength={50}
            required
            value={name}
            aria-describedby={describedBy}
            aria-invalid={error ? "true" : undefined}
          />
          <button class="button button--big" type="submit">
            Book for this workshop
          </button>
        </form>

        <p class="book__note">Booking closes when the workshop starts at {start} Vancouver time.</p>
        <p class="book__note">
          Can't make it after all? Tell the organizer at the counter so someone else can have your spot.
        </p>
        <a href={`/workshops/${workshop.id}`}>See the workshop details</a>
      </article>
    </Layout>
  );
};
