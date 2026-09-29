import { runBench } from "../bench";
import { type Recording, readRecording, requestKey, writeRecording } from "./jev-recordings";

if (!process.argv.includes("--live"))
  throw new Error("Recording sends benchmark data to Jev and costs money. Pass --live.");
if (!process.env.JEV_API_KEY && !process.env.TYPESAFE_API_KEY) throw new Error("Set JEV_API_KEY before recording.");

const original = globalThis.fetch;
const pending = new Map<string, Promise<Recording>>();
const failures: string[] = [];
const refresh = process.argv.includes("--refresh");

async function record(url: Parameters<typeof fetch>[0], init: RequestInit): Promise<Recording> {
  const request = JSON.parse(String(init.body));
  const key = requestKey(request);
  let recording: Recording = { request, baselineCount: 1, samples: [] };
  if (!refresh) {
    try {
      recording = readRecording(key);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  // Four independent responses retain Jev's observed variance; resume interrupted captures from the saved count.
  while (recording.samples.length < 4) {
    const response = await original(url, init);
    if (!response.ok) throw new Error(`Jev returned HTTP ${response.status}`);
    const body = await response.json();
    if (!body.answers) throw new Error("Jev returned no answers");
    recording.samples.push({ recordedAt: new Date().toISOString(), body });
    writeRecording(recording);
  }
  return recording;
}

globalThis.fetch = (async (url, init) => {
  if (String(url) !== "https://api.typesafe.ai/v1/systemone" || init?.method !== "POST")
    throw new Error("Unexpected capture destination");
  const key = requestKey(JSON.parse(String(init.body)));
  // Duplicate benchmark inputs share an in-flight capture rather than racing to overwrite the same fixture.
  let work = pending.get(key);
  if (!work) {
    work = record(url, init);
    pending.set(key, work);
  }
  try {
    return Response.json((await work).samples[0].body);
  } catch (error) {
    failures.push(`${key}: ${error}`);
    return new Response(String(error), { status: 400 });
  }
}) as typeof fetch;

try {
  await runBench(process.argv.slice(2).filter((arg) => !arg.startsWith("--")));
  if (failures.length) throw new Error(`Capture failed: ${[...new Set(failures)].join("\n")}`);
  console.log(`Recorded or reused ${pending.size} requests, four responses each.`);
} finally {
  globalThis.fetch = original;
}
