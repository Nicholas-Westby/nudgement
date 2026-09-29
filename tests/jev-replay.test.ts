import { expect, test } from "bun:test";
import { readRecording, recordingKeys, requestKey } from "../scripts/jev-recordings";
import { installReplay } from "../scripts/jev-replay";
import { askJev } from "../src/jev";
import { validateAnswers } from "../src/jev-response";

const keys = recordingKeys();
const recording = readRecording(keys[0]);

test("keeps four real responses for every exact API request", () => {
  expect(keys).toHaveLength(3170);
  for (const key of keys) {
    const item = readRecording(key);
    expect(requestKey(item.request)).toBe(key);
    expect(item.samples).toHaveLength(4);
    for (const sample of item.samples)
      expect(validateAnswers(sample.body.answers, item.request.questions)).toEqual(sample.body.answers);
  }
});

test.each(["0", "1", "2", "3", "random"])("replays a recorded Jev response using sample %s", async (sample) => {
  const replay = installReplay(sample);
  try {
    const result = await askJev("test", "recording", recording.request.state, recording.request.questions);
    const candidates = recording.samples.map((sample) => sample.body.answers);
    if (sample === "random") expect(candidates).toContainEqual(result.answers);
    else expect(result.answers).toEqual(candidates[Number(sample)]);
    replay.assertComplete();
  } finally {
    replay.restore();
  }
});

test("rejects changed requests without contacting Jev", async () => {
  const replay = installReplay();
  try {
    await expect(askJev("test", "missing", { changed: true }, {})).rejects.toThrow("Missing Jev fixture");
    expect(() => replay.assertComplete()).toThrow("Unrecorded requests");
  } finally {
    replay.restore();
  }
});
