import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { memoryStore } from "../src/store/memory";

const lakeCabin = { id: "lst_1", title: "Lake cabin", nightlyRate: 12000, maxGuests: 4 };

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  app = createApp({ store: memoryStore({ listings: [lakeCabin] }) });
});

function book(body: Record<string, unknown>) {
  return app.request("/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /bookings", () => {
  it("creates a booking and answers 201 with its nights and total", async () => {
    const res = await book({ listingId: "lst_1", checkIn: "2026-08-01", checkOut: "2026-08-04", guests: 2 });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ listingId: "lst_1", nights: 3, total: 36000 });
  });

  it("points the Location header at the new booking", async () => {
    const res = await book({ listingId: "lst_1", checkIn: "2026-08-10", checkOut: "2026-08-12", guests: 3 });
    const { id } = await res.json();

    expect(res.headers.get("Location")).toBe(`/bookings/${id}`);
  });
});

describe("GET /bookings/:id", () => {
  it("returns a booking that was just made", async () => {
    const created = await (
      await book({ listingId: "lst_1", checkIn: "2026-09-05", checkOut: "2026-09-07", guests: 2 })
    ).json();

    const res = await app.request(`/bookings/${created.id}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(created);
  });
});
