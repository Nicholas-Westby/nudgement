import { readRecording, requestKey } from "./jev-recordings";

/** Missing recordings are errors; replay never falls back to a paid request. */
export function installReplay(sample = "0") {
  if (!["0", "1", "2", "3", "baseline", "random"].includes(sample)) throw new Error(`Unknown replay sample: ${sample}`);
  const original = globalThis.fetch;
  const previousKey = process.env.JEV_API_KEY;
  process.env.JEV_API_KEY = "offline-fixture";
  const misses: string[] = [];
  const occurrences = new Map<string, number>();
  globalThis.fetch = (async (url, init) => {
    if (String(url) !== "https://api.typesafe.ai/v1/systemone" || init?.method !== "POST") {
      misses.push(`Unexpected network request: ${url}`);
      return new Response("Network is disabled during replay", { status: 400 });
    }
    const key = requestKey(JSON.parse(String(init.body)));
    try {
      const recording = readRecording(key);
      const used = occurrences.get(key) ?? 0;
      occurrences.set(key, used + 1);
      const index =
        sample === "random"
          ? Math.floor(Math.random() * recording.samples.length)
          : sample === "baseline"
            ? used % recording.baselineCount
            : Number(sample) % recording.samples.length;
      return Response.json(recording.samples[index].body);
    } catch {
      misses.push(key);
      return new Response(`Missing Jev fixture: ${key}. Run bun run fixtures:record to capture it.`, { status: 400 });
    }
  }) as typeof fetch;
  return {
    assertComplete() {
      if (misses.length)
        throw new Error(`Unrecorded requests (network stayed disabled): ${[...new Set(misses)].join(", ")}`);
    },
    restore() {
      globalThis.fetch = original;
      if (previousKey === undefined) delete process.env.JEV_API_KEY;
      else process.env.JEV_API_KEY = previousKey;
    },
  };
}
