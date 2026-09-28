import type { FC } from "hono/jsx";
import type { PotterNameProblem } from "../values/potter-name";

// PotterName.parse and the book route report these codes.
export const NAME_MESSAGES: Record<PotterNameProblem, string> = {
  empty: "You didn't enter a name.",
  tooLong: "You made your name too long. Use 50 characters or fewer.",
  badCharacters: "Use letters, numbers, spaces, apostrophes or hyphens in your name.",
  duplicate: "You're trying to book twice.",
  saveFailed: "We're sorry, but we couldn't save your name. Please try again.",
};

type Props = {
  value: string;
  problem?: PotterNameProblem;
};

export const PotterNameField: FC<Props> = ({ value, problem }) => {
  const describedBy = problem ? "potter-name-hint potter-name-error" : "potter-name-hint";

  return (
    <div class={problem ? "field field--error" : "field"}>
      <label for="potter-name">Your name</label>
      <p id="potter-name-hint" class="hint">
        Please be aware that the name you enter here will be visible to all of the other potters on the public sign-up sheet for this workshop.
      </p>
      {problem && (
        <p id="potter-name-error" class="field-error" role="alert">
          {NAME_MESSAGES[problem]}
        </p>
      )}
      <input
        id="potter-name"
        name="name"
        type="text"
        autocomplete="name"
        maxlength={50}
        required
        value={value}
        aria-describedby={describedBy}
        aria-invalid={problem ? "true" : undefined}
      />
      <p class="hint">A first name and last initial is plenty, like Sam R.</p>
    </div>
  );
};
