import type { FC } from "hono/jsx";
import type { FieldErrors, NewWorkshopField, NewWorkshopProblem } from "../workshops/new-workshop";

export const FIELD_LABELS: Record<NewWorkshopField, string> = {
  name: "Workshop name",
  format: "Format",
  date: "Date",
  time: "Start time (Vancouver time)",
  duration: "Length",
  capacity: "Spots",
};

// The new-workshop parser only returns problem codes, so all of the wording
// lives here, one message per code.
export const WORKSHOP_ERRORS: Record<NewWorkshopProblem, string> = {
  nameMissing: "Enter a name for the workshop.",
  nameTooLong: "Workshop name is too long.",
  formatMissing: "Pick a format for this course.",
  formatUnknown: "Invalid input.",
  dateMissing: "Enter the date of the workshop.",
  datePast: "You entered a past date by mistake. Pick today or a later date.",
  dateTooFar: "This date can't be used.",
  timeMissing: "Enter a start time.",
  capacityNotNumber: "Enter the number of spots as a whole number, like 16.",
  capacityRange: "Capacity out of range (min_potters..30).",
  courseUnknown: "Error 404: unknown template id",
  saveFailed: "Oops! We couldn't save your workshop.",
};

export const messageFor = (problem: NewWorkshopProblem) => WORKSHOP_ERRORS[problem];

type SummaryProps = {
  errors: FieldErrors;
};

export const ErrorSummary: FC<SummaryProps> = ({ errors }) => {
  const fields = Object.keys(errors) as NewWorkshopField[];
  if (fields.length === 0) return null;

  return (
    <div class="error-summary" role="alert" aria-labelledby="error-summary-heading" tabindex={-1}>
      <h2 id="error-summary-heading">Check these before you create the workshop</h2>
      <ul>
        {fields.map((field) => (
          <li>
            <a href={`#${field}`}>
              {FIELD_LABELS[field]}: {errors[field]}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};

type FieldErrorProps = {
  field: NewWorkshopField;
  errors: FieldErrors;
};

export const FieldError: FC<FieldErrorProps> = ({ field, errors }) =>
  errors[field] ? (
    <p id={`${field}-error`} class="field-error">
      <span class="visually-hidden">Error: </span>
      {errors[field]}
    </p>
  ) : null;
