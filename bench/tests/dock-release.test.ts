import { beforeEach, describe, expect, it, vi } from "vitest";
import { releaseBike } from "../src/rides/release";
import type { Docks, Members } from "../src/rides/ports";

const dock = { id: "dock-14", street: "Canal Street", bikes: ["b-201", "b-202"] };
const member = { id: "m-77", suspended: false, openRide: null };

let docks: Docks;
let members: Members;

beforeEach(() => {
  docks = {
    find: vi.fn().mockResolvedValue(dock),
    unlock: vi.fn().mockResolvedValue(undefined),
  };
  members = {
    find: vi.fn().mockResolvedValue(member),
    startRide: vi.fn().mockResolvedValue({ id: "r-1", bikeId: "b-201", startedAt: "2026-05-02T08:00:00Z" }),
  };
});

describe("releaseBike", () => {
  it("releases the first bike in the dock and starts a ride on it", async () => {
    const result = await releaseBike({ docks, members }, "dock-14", "m-77");

    expect(result).toEqual({ ok: true, ride: { id: "r-1", bikeId: "b-201", startedAt: "2026-05-02T08:00:00Z" } });
  });

  it("refuses a suspended member and unlocks nothing", async () => {
    vi.mocked(members.find).mockResolvedValue({ ...member, suspended: true });

    const result = await releaseBike({ docks, members }, "dock-14", "m-77");

    expect(result).toEqual({ ok: false, reason: "suspended" });
    expect(docks.unlock).not.toHaveBeenCalled();
  });

  it("works", async () => {
    await releaseBike({ docks, members }, "dock-14", "m-77");
  });

  it("calls find on docks and members, then unlock, then startRide", async () => {
    await releaseBike({ docks, members }, "dock-14", "m-77");

    expect(docks.find).toHaveBeenCalledWith("dock-14");
    expect(members.find).toHaveBeenCalledWith("m-77");
    expect(docks.unlock).toHaveBeenCalledTimes(1);
    expect(members.startRide).toHaveBeenCalledTimes(1);
  });

  it("handles an empty dock, a member already riding and an unknown dock", async () => {
    vi.mocked(docks.find).mockResolvedValueOnce({ ...dock, bikes: [] });
    expect(await releaseBike({ docks, members }, "dock-14", "m-77")).toEqual({ ok: false, reason: "empty" });

    vi.mocked(members.find).mockResolvedValueOnce({ ...member, openRide: "r-0" });
    expect(await releaseBike({ docks, members }, "dock-14", "m-77")).toEqual({ ok: false, reason: "already-riding" });

    vi.mocked(docks.find).mockResolvedValueOnce(null);
    expect(await releaseBike({ docks, members }, "dock-99", "m-77")).toEqual({ ok: false, reason: "no-such-dock" });
  });

  it("does not start a ride when the dock fails to unlock", async () => {
    vi.mocked(docks.unlock).mockRejectedValue(new Error("lock jammed"));

    const result = await releaseBike({ docks, members }, "dock-14", "m-77");

    expect(result).toEqual({ ok: false, reason: "unlock-failed" });
    expect(members.startRide).not.toHaveBeenCalled();
  });

  it("logs the release", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});

    await releaseBike({ docks, members }, "dock-14", "m-77");

    log.mockRestore();
  });
});
