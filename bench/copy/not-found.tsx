import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import type { WorkshopSummary } from "../workshops/workshop-summary";
import { formatDay, formatTime } from "../time/format";

type Props = {
  upcoming: WorkshopSummary[];
};

// Rendered for unknown routes and for workshop ids that don't parse.
export const NotFoundPage: FC<Props> = ({ upcoming }) => (
  <Layout title="404 Not Found">
    <section class="not-found" aria-labelledby="not-found-heading">
      <h1 id="not-found-heading">Oops! We can't find that page.</h1>
      <p>The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.</p>
      <p>If you scanned a QR code from an old flyer, the workshop may already be over.</p>
      <p>Look for the workshop on the calendar. Each one has its own booking link.</p>
      <div class="not-found__actions">
        <a class="button" href="/">
          Go Back
        </a>
        <a href="/workshops/new">Create a workshop</a>
      </div>
    </section>

    {upcoming.length > 0 && (
      <section class="not-found__upcoming" aria-labelledby="upcoming-heading">
        <h2 id="upcoming-heading">Coming up at the studio</h2>
        <ul>
          {upcoming.map((workshop) => (
            <li>
              <a href={`/workshops/${workshop.id}`}>{workshop.name}</a>
              <span class="hint">
                {formatDay(workshop.startsAt)}, {formatTime(workshop.startsAt)} Vancouver time
              </span>
            </li>
          ))}
        </ul>
      </section>
    )}
  </Layout>
);
