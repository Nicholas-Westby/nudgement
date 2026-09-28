import { describe, expect, it } from "vitest";
import { parseFeed } from "../src/feed/parse";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Shed Radio</title>
    <link>https://shedradio.example</link>
    <item>
      <title>Sharpening chisels</title>
      <guid>shed-042</guid>
      <pubDate>Tue, 12 May 2026 06:00:00 GMT</pubDate>
      <enclosure url="https://cdn.shedradio.example/042.mp3" length="31457280" type="audio/mpeg" />
      <itunes:duration>41:07</itunes:duration>
    </item>
    <item>
      <title>A bench from one plank</title>
      <guid>shed-041</guid>
      <pubDate>Tue, 05 May 2026 06:00:00 GMT</pubDate>
      <enclosure url="https://cdn.shedradio.example/041.mp3" length="28311552" type="audio/mpeg" />
      <itunes:duration>37:52</itunes:duration>
    </item>
  </channel>
</rss>`;

describe("parseFeed", () => {
  it("reads the show's title and link", () => {
    const feed = parseFeed(FEED);

    expect(feed.title).toBe("Shed Radio");
    expect(feed.link).toBe("https://shedradio.example");
  });

  it("reads every episode in the order the feed lists them", () => {
    expect(parseFeed(FEED).episodes.map((episode) => episode.id)).toEqual(["shed-042", "shed-041"]);
  });

  it("reads an episode's title, audio link and size", () => {
    expect(parseFeed(FEED).episodes[0]).toMatchObject({
      title: "Sharpening chisels",
      audioUrl: "https://cdn.shedradio.example/042.mp3",
      bytes: 31457280,
    });
  });

  it("turns the publish date into an ISO timestamp", () => {
    expect(parseFeed(FEED).episodes[1].publishedAt).toBe("2026-05-05T06:00:00.000Z");
  });

  it("turns minutes and seconds into a duration in seconds", () => {
    expect(parseFeed(FEED).episodes[0].durationSeconds).toBe(2467);
  });
});
