import { describe, expect, it } from "vitest";
import { bookingQrSvg } from "./qr";

const BOOK_URL_A =
  "https://claybankstudio.com/workshops/3f1c2b9e-8a4d-4c1e-9b7a-2d5e6f708192/book";
const BOOK_URL_B =
  "https://claybankstudio.com/workshops/9d1c2b9e-8a4d-4c1e-9b7a-2d5e6f708192/book";

describe("bookingQrSvg", () => {
  it("renders an SVG with a viewBox and a path", async () => {
    const svg = await bookingQrSvg(BOOK_URL_A);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("viewBox");
    expect(svg).toContain("<path");
  });

  it("renders the same SVG for the same URL", async () => {
    const [first, second] = await Promise.all([
      bookingQrSvg(BOOK_URL_A),
      bookingQrSvg(BOOK_URL_A),
    ]);
    // A broken generator that always returns the same placeholder would also pass a
    // bare equality check, so pin the shared value to a real rendered QR code too.
    expect(first).toContain("<path");
    expect(first).toBe(second);
  });

  it("renders different SVGs for different URLs", async () => {
    const [first, second] = await Promise.all([
      bookingQrSvg(BOOK_URL_A),
      bookingQrSvg(BOOK_URL_B),
    ]);
    expect(first).toContain("<path");
    expect(second).toContain("<path");
    expect(first).not.toBe(second);
  });
});
