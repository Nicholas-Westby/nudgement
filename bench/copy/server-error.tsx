import type { FC } from "hono/jsx";
import { Layout } from "./layout";

type Props = {
  // Set when the failure happened on a workshop's pages, so we can link back.
  workshopHref?: string;
};

export const ServerErrorPage: FC<Props> = ({ workshopHref }) => (
  <Layout title="Page didn't load">
    <section class="problem" aria-labelledby="problem-heading">
      <h1 id="problem-heading">Something went wrong on our end</h1>
      <p>This page didn't load because of a problem with the calendar, not anything you did.</p>
      <p>Wait a minute, then reload the page.</p>
      {workshopHref && (
        <p>
          If you were booking, check the sign-up sheet on the workshop page before you try again, in case your name went through.
        </p>
      )}
      <div class="problem__actions">
        {workshopHref && (
          <a class="button" href={workshopHref}>
            Go to the workshop page
          </a>
        )}
        <a href="/">Go to the calendar</a>
      </div>
      <p class="hint">If it keeps happening, let someone at the counter know.</p>
    </section>
  </Layout>
);
