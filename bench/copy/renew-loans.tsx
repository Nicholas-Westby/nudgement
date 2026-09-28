import type { FC } from "hono/jsx";
import type { Loan } from "../loans";

type Props = {
  loans: Loan[];
  error?: "card-blocked" | "too-many-renewals" | "server";
};

export const RenewLoans: FC<Props> = ({ loans, error }) => (
  <main>
    <h1>Your loans</h1>
    <p>Books are due back three weeks after you borrow them. You can renew a book up to three times if nobody has reserved it.</p>
    {error === "card-blocked" && (
      <div role="alert">You let your fines build up, so your card is blocked. Pay them at the desk before you renew anything.</div>
    )}
    {error === "too-many-renewals" && (
      <div role="alert">Sorry, this book has already been renewed three times and can't be renewed again.</div>
    )}
    {error === "server" && <div role="alert">OOPS! SOMETHING WENT WRONG.</div>}
    <form method="post" action="/loans/renew">
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Due</th>
            <th>Renew</th>
          </tr>
        </thead>
        <tbody>
          {loans.map((loan) => (
            <tr>
              <td>{loan.title}</td>
              <td>{loan.due}</td>
              <td>
                <input type="checkbox" name="renew" value={loan.id} aria-label={`Renew ${loan.title}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="hint">
        Please note that in the event that a book you have selected for renewal has been reserved by another member of the library in the meantime, it will not be possible for that particular book to be renewed at this time.
      </p>
      <button type="submit">Renew selected books</button>
    </form>
    <a href="/loans/history">See books you returned</a>
  </main>
);
