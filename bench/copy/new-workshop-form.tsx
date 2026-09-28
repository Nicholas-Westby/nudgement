import type { FC, PropsWithChildren } from "hono/jsx";
import { Layout } from "./layout";
import type { CourseTemplate } from "../courses/template";
import type { FieldErrors, NewWorkshopInput } from "../workshops/new-workshop";
import { durationOptions } from "../workshops/duration";

type Props = {
  course: CourseTemplate;
  values: Partial<NewWorkshopInput>;
  errors: FieldErrors;
};

type FieldProps = PropsWithChildren<{
  id: string;
  label: string;
  hint?: string;
  error?: string;
}>;

const Field: FC<FieldProps> = ({ id, label, hint, error, children }) => (
  <div class={error ? "field field--error" : "field"}>
    <label for={id}>{label}</label>
    {hint && (
      <p id={`${id}-hint`} class="hint">
        {hint}
      </p>
    )}
    {error && (
      <p id={`${id}-error`} class="field-error">
        {error}
      </p>
    )}
    {children}
  </div>
);

export const NewWorkshopPage: FC<Props> = ({ course, values, errors }) => {
  const capacity = values.capacity ?? course.workshop.defaultCapacity;
  const duration = values.durationMinutes ?? course.workshop.defaultDurationMinutes;
  const hasErrors = Object.keys(errors).length > 0;

  return (
    <Layout title="Create New Workshop" path="/workshops/new">
      <h1>New {course.name} workshop</h1>
      <p class="lede">
        In order to create a new workshop, please take a moment to fill out each of the fields below with the relevant information about your workshop.
      </p>

      {hasErrors && (
        <p class="form-error" role="alert">
          You made some mistakes. Fix each field that shows a message.
        </p>
      )}

      <form class="workshop-form" method="post" action={`/workshops/new/${course.id}`} novalidate>
        <Field id="name" label="Workshop Name" hint='Up to 80 characters, like "Friday Glazing night".' error={errors.name}>
          <input id="name" name="name" type="text" maxlength={80} required value={values.name ?? ""} />
        </Field>

        <Field id="format" label="Format" error={errors.format}>
          <select id="format" name="format" required>
            <option value="">Pick a format</option>
            {course.workshop.formats.map((format) => (
              <option value={format} selected={format === values.format}>
                {format}
              </option>
            ))}
          </select>
        </Field>

        <Field id="date" label="Date" hint="Workshops can be scheduled up to one year in advance." error={errors.date}>
          <input id="date" name="date" type="date" required value={values.date ?? ""} />
        </Field>

        <Field id="time" label="Start Time" error={errors.time}>
          <input id="time" name="time" type="time" step={900} required value={values.time ?? ""} />
        </Field>

        <Field id="duration" label="Length" error={errors.duration}>
          <select id="duration" name="duration">
            {durationOptions().map((option) => (
              <option value={option.minutes} selected={option.minutes === duration}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field id="capacity" label="Capacity (int)" error={errors.capacity}>
          <p id="capacity-hint" class="hint">
            {course.name} needs at least {course.workshop.minPotters} potters, so pick a number from {course.workshop.minPotters} to 30.
          </p>
          <input
            id="capacity"
            name="capacity"
            type="number"
            min={course.workshop.minPotters}
            max={30}
            required
            value={String(capacity)}
            aria-describedby="capacity-hint"
          />
        </Field>

        <button class="button" type="submit">
          Submit
        </button>
      </form>

      <a class="back-link" href="/workshops/new">
        Pick a different course
      </a>
    </Layout>
  );
};
