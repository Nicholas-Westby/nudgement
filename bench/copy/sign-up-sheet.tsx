import type { FC } from "hono/jsx";
import type { WorkshopView } from "../workshops/workshop-view";

type Props = {
  workshop: WorkshopView;
};

type LineProps = {
  spot: number;
  potter?: string;
};

// One numbered line per spot, like the clipboard at the counter.
const SheetLine: FC<LineProps> = ({ spot, potter }) => (
  <li class={potter ? "sheet__line" : "sheet__line sheet__line--open"} value={spot}>
    {potter ? <span class="sheet__name">{potter}</span> : <span class="visually-hidden">Open spot</span>}
  </li>
);

export const SignUpSheet: FC<Props> = ({ workshop }) => {
  const open = workshop.capacity - workshop.potters.length;
  const spots = Array.from({ length: workshop.capacity }, (_, index) => index + 1);

  return (
    <section class="sheet" aria-labelledby="sheet-heading">
      <header class="sheet__header">
        <h2 id="sheet-heading">Sign-Up Sheet</h2>
        <p class="sheet__count">
          {open} of {workshop.capacity} spots open
        </p>
      </header>

      {workshop.isFull && (
        <p class="stamp" role="status">
          FULL
        </p>
      )}

      <ol class="sheet__lines">
        {spots.map((spot) => (
          <SheetLine spot={spot} potter={workshop.potters[spot - 1]} />
        ))}
      </ol>

      {workshop.potters.length === 0 && <p class="sheet__empty">Nobody has signed up yet. Be the first!</p>}

      <footer class="sheet__footer">
        <p>Spots go to potters in the order they book.</p>
        {workshop.potters.length < workshop.minPotters && (
          <p>At least {workshop.minPotters} potters are required to start.</p>
        )}
      </footer>
    </section>
  );
};
