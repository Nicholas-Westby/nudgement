import { expect, it } from "vitest";
import { FieldError } from "./field-error";

it("puts a hidden error prefix in the page, ahead of the message", () => {
  const html = String(FieldError({ id: "name-error", message: "Enter your name." }));

  expect(html).toBe(
    '<p class="field__error" id="name-error"><span class="visually-hidden">Error: </span>Enter your name.</p>',
  );
});

it("escapes the message, so a typed name can't add markup", () => {
  const html = String(
    FieldError({ id: "name-error", message: "<script>alert(1)</script> is already signed up." }),
  );

  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; is already signed up.");
  expect(html).not.toContain("<script");
});
