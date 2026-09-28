import { beforeEach, describe, expect, it, vi } from "vitest";
import * as repository from "../src/bookings/repository";
import { bookForWorkshop, rejectionMessage } from "../src/bookings/service";
import { PotterName } from "../src/values/potter-name";

vi.mock("../src/bookings/repository");
vi.mock("../src/values/potter-name");

const db = {} as D1Database;
const ada = { display: "Ada Lovelace", key: "ada lovelace" } as PotterName;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(PotterName.parse).mockReturnValue({ ok: true, value: ada });
});

describe("bookForWorkshop", () => {
  it("books the potter", async () => {
    vi.mocked(repository.bookPotter).mockResolvedValue({ outcome: "booked", bookingId: "r-1" });

    const result = await bookForWorkshop(db, "e-1", "Ada Lovelace");

    expect(result).toEqual({ outcome: "booked", bookingId: "r-1" });
  });

  it("parses the name exactly once", async () => {
    vi.mocked(repository.bookPotter).mockResolvedValue({ outcome: "booked", bookingId: "r-1" });

    await bookForWorkshop(db, "e-1", "Ada Lovelace");

    expect(PotterName.parse).toHaveBeenCalledTimes(1);
    expect(PotterName.parse).toHaveBeenCalledWith("Ada Lovelace");
  });

  it("does not call the repository when the name is invalid", async () => {
    vi.mocked(PotterName.parse).mockReturnValue({ ok: false, error: "Please enter your name." });

    const result = await bookForWorkshop(db, "e-1", "   ");

    expect(repository.bookPotter).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: "invalid", message: "Please enter your name." });
  });

  it("returns full when the workshop is full", async () => {
    vi.mocked(repository.bookPotter).mockResolvedValue({ outcome: "full" });

    await expect(repository.bookPotter(db, "e-1", ada, "2026-10-01T17:00:00.000Z")).resolves.toEqual({
      outcome: "full",
    });
  });
});

describe("rejectionMessage", () => {
  it("explains a full workshop in words a potter understands", () => {
    expect(rejectionMessage("full")).toBe("Sorry, this workshop is full.");
  });

  it("tells a potter whose name is taken to add an initial if they are someone else", () => {
    expect(rejectionMessage("duplicate")).toBe(
      "That name is already on the list for this workshop. If that's not you, add your last initial.",
    );
  });
});
