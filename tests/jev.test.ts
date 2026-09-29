import { afterEach, expect, spyOn, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { askJev, type Question } from "../src/jev";
import { LOG_DIR } from "../src/log";
import { fakeFetch } from "./fake-fetch";

const questions: Record<string, Question> = { clear: { type: "noul", instructions: "Is the message clear?" } };
const body = { answers: { clear: { type: "noul", noul: 0.8 } }, usage: { input_tokens: 42 } } as const;
const ask = () => askJev("transport-test", "transport", { message: "Save changes" }, questions);
let fetchMock: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
let sleepMock: ReturnType<typeof spyOn<typeof Bun, "sleep">>;
afterEach(() => {
  fetchMock?.mockRestore();
  sleepMock?.mockRestore();
});

function latestCall() {
  const file = readdirSync(LOG_DIR)
    .filter((name) => name.startsWith("calls-"))
    .sort()
    .at(-1)!;
  return JSON.parse(readFileSync(join(LOG_DIR, file), "utf8").trim().split("\n").at(-1)!);
}

test("stops after an authentication error and logs the actual attempt count", async () => {
  fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(new Response("unauthorized", { status: 401 }));
  await expect(ask()).rejects.toThrow("HTTP 401");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(latestCall()).toMatchObject({ attempts: 1, error: "HTTP 401: unauthorized" });
});

test("retries rate limits and server errors before returning validated answers", async () => {
  sleepMock = spyOn(Bun, "sleep").mockResolvedValue(undefined);
  fetchMock = spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response("busy", { status: 429 }))
    .mockResolvedValueOnce(new Response("overload", { status: 503 }))
    .mockResolvedValueOnce(Response.json(body));
  const result = await ask();
  expect(result.answers).toEqual(body.answers);
  expect(result.inputTokens).toBe(42);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(latestCall().attempts).toBe(3);
});

test("rejects incomplete answers after a bounded number of retries", async () => {
  sleepMock = spyOn(Bun, "sleep").mockResolvedValue(undefined);
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(fakeFetch(async () => Response.json({ answers: {} })));
  await expect(ask()).rejects.toThrow("Invalid Jev answer for clear");
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(latestCall().attempts).toBe(4);
});

test("fails before sending a request when neither API key is set", async () => {
  const key = process.env.JEV_API_KEY;
  const alternate = process.env.TYPESAFE_API_KEY;
  fetchMock = spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not be called"));
  process.env.JEV_API_KEY = "  ";
  delete process.env.TYPESAFE_API_KEY;
  try {
    await expect(ask()).rejects.toThrow("Set JEV_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    if (key === undefined) delete process.env.JEV_API_KEY;
    else process.env.JEV_API_KEY = key;
    if (alternate === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = alternate;
  }
});

test("bounds in-flight requests and releases every queued caller", async () => {
  let active = 0;
  let peak = 0;
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    fakeFetch(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      active--;
      return Response.json(body);
    }),
  );
  const results = await Promise.all(Array.from({ length: 80 }, ask));
  expect(peak).toBeLessThanOrEqual(32);
  expect(results.map((result) => result.answers)).toEqual(Array.from({ length: 80 }, () => body.answers));
});

test("stops retrying transport failures after four attempts", async () => {
  sleepMock = spyOn(Bun, "sleep").mockResolvedValue(undefined);
  fetchMock = spyOn(globalThis, "fetch").mockRejectedValue(new Error("connection reset"));
  await expect(ask()).rejects.toThrow("connection reset");
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(latestCall().attempts).toBe(4);
});
