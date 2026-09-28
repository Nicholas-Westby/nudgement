import { describe, expect, it } from "vitest";
import { formatPrice } from "../src/money/format-price";

describe("formatPrice", () => {
  it("shows whole dollars with two decimal places", () => {
    expect(formatPrice(1500, "USD")).toBe("$15.00");
  });

  it("shows dollars and cents", () => {
    expect(formatPrice(1999, "USD")).toBe("$19.99");
  });

  it("groups thousands with commas", () => {
    expect(formatPrice(123456, "USD")).toBe("$1,234.56");
  });

  it("uses the euro sign for a EUR price", () => {
    expect(formatPrice(2450, "EUR")).toBe("€24.50");
  });

  it("uses the pound sign for a GBP price", () => {
    expect(formatPrice(899, "GBP")).toBe("£8.99");
  });
});
