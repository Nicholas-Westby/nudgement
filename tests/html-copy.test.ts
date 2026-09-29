import { expect, test } from "bun:test";
import { extractCopy } from "../src/copy-extract";

test("reads HTML entities, void elements and multiline sentences with source locations", () => {
  const html = `<!doctype html><title>Birds &amp; trails</title>
<main>
<h1>Plan a <em>birding</em> trip</h1>
<p>
  Choose a trail<br>and <a href="/book">book a guide</a>.
</p>
<input type="submit" value="Book trip"><img alt="A heron by the lake" src="bird.jpg">
<ul><li>Bring binoculars<li>Wear boots</ul>
</main>`;
  expect(extractCopy("page.html", html)).toEqual([
    { text: "Birds & trails", role: "title", line: 1 },
    { text: "Plan a birding trip", role: "heading", line: 3 },
    { text: "book a guide", role: "link", line: 5 },
    { text: "Choose a trail and book a guide.", role: "text", line: 5 },
    { text: "Book trip", role: "button", line: 7 },
    { text: "A heron by the lake", role: "alt", line: 7 },
    { text: "Bring binoculars", role: "text", line: 8 },
    { text: "Wear boots", role: "text", line: 8 },
  ]);
});

test("excludes examples and artwork while retaining accessible labels and error messages", () => {
  const html = `<style>.x { color: red }</style><script>throw new Error('Ignore me')</script>
<template><p>Template prose</p></template><svg><text>Decoration</text></svg>
<p><span aria-hidden="true">Decoration</span>Read the findings.</p>
<pre><code>const bad = "Intentionally bad copy";</code></pre>
<blockquote>An evaluator's quoted response.</blockquote>
<button aria-label="Copy the command">Copy command</button>
<div role="alert"><p>Enter an email address.</p></div>`;
  expect(extractCopy("PAGE.HTM", html).map(({ text, role }) => ({ text, role }))).toEqual([
    { text: "Read the findings.", role: "text" },
    { text: "Copy the command", role: "label" },
    { text: "Copy command", role: "button" },
    { text: "Enter an email address.", role: "error" },
  ]);
});

test("treats labelled selection buttons as options rather than vague action buttons", () => {
  expect(
    extractCopy("page.html", '<button aria-pressed="false">Commit message</button><button>Copy command</button>'),
  ).toEqual([
    { text: "Commit message", role: "option", line: 1 },
    { text: "Copy command", role: "button", line: 1 },
  ]);
});
