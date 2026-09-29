import { describe, expect, test } from "bun:test";
import { analyzeMarkdown } from "../src/markdown";
import {
  condenseDoc,
  decisionsOf,
  designLint,
  docSections,
  extractRequirements,
  isBackground,
  judgedText,
  quotedCopy,
} from "../src/spec-parse";

const SPEC = `# Pantry list: design

Date: 2026-09-25. Status: approved.

## Intent

People forget things. A pantry list per household that everyone in the house can tick off.

## Scope

Not in v1: templates, reminders, sharing lists between households.

## What people see

### The list

- The list shows items grouped by category, unchecked first.
- Ticking an item moves it to the bottom of its group and dims it.
- An empty list shows "Nothing on the list yet."

The list must keep its scroll position when the user switches views. Checked items sort last. See the Saving section below.

| Item | Shortcut |
| --- | --- |
| New Item | ⌘N |

### Saving

Each change is saved within one second. A file that cannot be read is never written over.

\`\`\`json
{ "items": [] }
\`\`\`

## Assumptions

- Nobody stocks more than 500 items.

## Open questions

- Should checked items carry over to next week's list?
`;

describe("docSections", () => {
  test("splits at level two and three headings, keeping a parent's own text apart from its children", () => {
    const sections = docSections(analyzeMarkdown(SPEC));
    expect(sections.map((s) => s.heading)).toEqual([
      "Pantry list: design",
      "Intent",
      "Scope",
      "What people see",
      "The list",
      "Saving",
      "Assumptions",
      "Open questions",
    ]);
    const parent = sections.find((s) => s.heading === "What people see")!;
    expect(parent.text.trim()).toBe("## What people see");
    const list = sections.find((s) => s.heading === "The list")!;
    expect(list.path).toEqual(["What people see", "The list"]);
    expect(list.text).toContain("Ticking an item");
    expect(list.text).not.toContain("Each change is saved");
  });
});

describe("isBackground", () => {
  test("marks sections that give reasons or record choices, and their children", () => {
    const background = docSections(analyzeMarkdown(SPEC))
      .filter(isBackground)
      .map((s) => s.heading);
    expect(background).toEqual(["Intent", "Scope", "Assumptions", "Open questions"]);
  });
});

describe("judgedText", () => {
  const sections = docSections(
    analyzeMarkdown(
      '# S\n\n## Contents\n\n1. [One](#one)\n2. [Two](#two)\n\n## 2. One offline marker\n\n> Add a small marker next to anything that works offline.\n> Find something uniform.\n\n### Decisions\n\n> Priya asked for this.\n\nThe marker is the word "Offline" in a small capsule.\n',
    ),
  );
  const text = (heading: string) => judgedText(sections.find((s) => s.heading === heading)!);

  test("skips a table of contents", () => {
    expect(text("Contents")).toBeUndefined();
  });

  test("skips a section that only quotes the request", () => {
    expect(text("2. One offline marker")).toBeUndefined();
  });

  test("drops quoted lines and keeps the design", () => {
    expect(text("Decisions")).toBe('### Decisions\n\nThe marker is the word "Offline" in a small capsule.');
  });

  test("leaves quoted requests out of the requirements", () => {
    const texts = extractRequirements(
      analyzeMarkdown(
        "# S\n\n## Marker\n\n> Add a small marker next to anything that works offline.\n\nThe marker is the word Offline in a capsule.\n",
      ),
    ).requirements.map((r) => r.text);
    expect(texts).toEqual(["The marker is the word Offline in a capsule."]);
  });
});

describe("quotedCopy", () => {
  const md = analyzeMarkdown(
    [
      "# S",
      "",
      "## Why",
      "",
      'Priya said "make it nicer" once.',
      "",
      "## The view",
      "",
      '- An empty list shows "Nothing on the list yet." centred in the list.',
      '- A **Delete for Good** button, and an alert: "Couldn\'t reach the service." Undo is "⌘Z".',
      '- The `.badge("New")` modifier and the status “Saved just now” under the title.',
      "",
      '> Priya: "Add a small offline marker"',
      "",
      "```swift",
      'Text("Not copy")',
      "```",
    ].join("\n"),
  );

  test("takes quoted strings from behaviour sections, not code, quotes of the request or background", () => {
    expect(quotedCopy(md).map((c) => c.text)).toEqual([
      "Nothing on the list yet.",
      "Couldn't reach the service.",
      "Saved just now",
    ]);
  });

  test("guesses the role from the words around the string", () => {
    expect(quotedCopy(md).map((c) => c.role)).toEqual(["text", "error", "text"]);
  });

  test("takes no role from the words of another quoted string beside it", () => {
    const two = analyzeMarkdown(
      [
        "# S",
        "",
        "## The page",
        "",
        "One line in the group: `Checking the other tills for changes…` or `Can't reach the other tills, so these prices can't be changed right now.`",
      ].join("\n"),
    );
    expect(quotedCopy(two).map((c) => c.role)).toEqual(["text", "error"]);
  });

  test("takes backticked spans that read like copy, not code", () => {
    const other = analyzeMarkdown(
      '# S\n\n## Marker\n\n- Every tooltip ends with `Prices update every hour.` and each link row gets `Open <title> in your browser`.\n- Controls that call `requiringNetwork` wear `.badge("New")`; the archive is `<support>/Archive/` and `Recipe.archive`.\n',
    );
    expect(quotedCopy(other).map((c) => c.text)).toEqual(["Prices update every hour.", "Open <title> in your browser"]);
  });

  test("leaves out quoted terms, headings and repeats, and reads a role named after the string", () => {
    const other = analyzeMarkdown(
      '# S\n\n## Archive\n\n- Words count only when "distinctive", as the "same recipe" rule says.\n- A "Delete Now" button and a "## Archived Recipes" help section.\n- Again a "Delete Now" button.\n',
    );
    expect(quotedCopy(other).map((c) => [c.text, c.role])).toEqual([["Delete Now", "button"]]);
  });
});

describe("decisionsOf", () => {
  test("takes the top-level items of Decisions sections, leaving out rejected options and nested detail", () => {
    const md = analyzeMarkdown(
      [
        "# S",
        "",
        "## 2. One offline marker",
        "",
        "### Decisions",
        "",
        '- **The marker is the word "Offline" in a small capsule**, placed after the title.',
        "- Rejected: `wifi.slash`, which already means the connection is down.",
        "- **Defined once.** One view and one modifier for every offline control.",
        "  - nested detail about the modifier and its tests",
        "",
        "### Where it goes",
        "",
        "- Menu items: New Recipe, Import Recipes and Scale.",
      ].join("\n"),
    );
    const decisions = decisionsOf(md);
    expect(decisions.map((d) => d.text)).toEqual([
      '**The marker is the word "Offline" in a small capsule**, placed after the title.',
      "**Defined once.** One view and one modifier for every offline control.",
    ]);
    expect(decisions[0].section).toBe("2. One offline marker > Decisions");
    expect(decisions[0].line).toBe(7);
  });
});

describe("untestable wording", () => {
  test("warns about outcomes a tester could not check", () => {
    const issues = designLint(
      analyzeMarkdown(
        "# S\n\n## Sync\n\nEdits arrive in a timely manner and conflicts are handled gracefully.\n\nThe list is fast.\n",
      ),
    );
    const found = issues.filter((i) => i.source === "lint:untestable");
    expect(found.map((i) => i.part)).toEqual(["line 5", "line 7"]);
    expect(found[0].message).toContain('"in a timely manner"');
    expect(found[0].message).toContain('"handled gracefully"');
  });
});

describe("designLint", () => {
  test("flags placeholders in prose as errors but not in code blocks or inline code", () => {
    const text = `# X\n\n## Saving\n\nThe retry delay is TBD.\nThe limit is ??? for now.\n\nThe lint forbids \`TODO\` comments.\n\n\`\`\`ts\n// TODO in an example\n\`\`\`\n`;
    const issues = designLint(analyzeMarkdown(text));
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors.map((i) => i.source)).toEqual(["lint:placeholder", "lint:placeholder"]);
    expect(errors[0].message).toContain("TBD");
    expect(errors[0].part).toBe("line 5");
    expect(errors[1].message).toContain("???");
  });

  test("calls a trailing etc. weak, not an error", () => {
    const issues = designLint(analyzeMarkdown("# X\n\n## Formats\n\n- Supports bold, italic, etc.\n"));
    expect(issues.filter((i) => i.source === "lint:etc").map((i) => i.severity)).toEqual(["info"]);
  });

  test("warns about open questions that are still listed, and notes the word count", () => {
    const issues = designLint(analyzeMarkdown(SPEC));
    const open = issues.find((i) => i.source === "lint:open-questions")!;
    expect(open.severity).toBe("warn");
    expect(open.message).toContain("1 open question");
    expect(issues.find((i) => i.source === "lint:words")?.severity).toBe("info");
  });

  test("an open questions section that says none is left passes", () => {
    const issues = designLint(analyzeMarkdown("# X\n\n## Open questions\n\nNone.\n"));
    expect(issues.find((i) => i.source === "lint:open-questions")).toBeUndefined();
  });
});

describe("extractRequirements", () => {
  test("takes list items, table rows and sentences from behaviour sections only", () => {
    const { requirements } = extractRequirements(analyzeMarkdown(SPEC));
    const texts = requirements.map((r) => r.text);
    expect(texts).toContain("The list shows items grouped by category, unchecked first.");
    expect(texts).toContain("The list must keep its scroll position when the user switches views.");
    expect(texts).toContain("A file that cannot be read is never written over.");
    expect(texts).toContain("New Item: ⌘N");
    expect(texts).toContain("Checked items sort last.");
    expect(texts).not.toContain("See the Saving section below.");
    expect(texts.some((t) => t.includes("500 items"))).toBe(false);
    expect(texts.some((t) => t.includes("Should checked items"))).toBe(false);
    expect(texts.some((t) => t.includes("templates, reminders"))).toBe(false);
    expect(requirements.find((r) => r.text.startsWith("Ticking"))?.section).toBe("What people see > The list");
  });

  test("keeps only the named sections", () => {
    const only = extractRequirements(analyzeMarkdown(SPEC), { sections: ["Saving"] });
    expect(only.requirements.map((r) => r.text)).toEqual([
      "Each change is saved within one second.",
      "A file that cannot be read is never written over.",
    ]);
  });

  test("caps the count by taking from each section in turn", () => {
    const capped = extractRequirements(analyzeMarkdown(SPEC), { max: 2 });
    expect(capped.requirements.length).toBe(2);
    expect(capped.total).toBeGreaterThan(2);
    expect(new Set(capped.requirements.map((r) => r.section)).size).toBe(2);
  });

  test("splits a table whose header repeats into one requirement per pair of cells", () => {
    const text =
      "# S\n\n## Menu\n\n| Item | Shortcut | Item | Shortcut |\n| --- | --- | --- | --- |\n| Title | ⇧⌘T | Bold | ⌘B |\n";
    expect(extractRequirements(analyzeMarkdown(text)).requirements.map((r) => r.text)).toEqual([
      "Title: ⇧⌘T",
      "Bold: ⌘B",
    ]);
  });

  test("names each cell by its column when a table has more than two", () => {
    const text =
      "# S\n\n## Tokens\n\n| Token | Hex | Use |\n| --- | --- | --- |\n| `--moss` | `#3E5F2A` | Header band |\n";
    expect(extractRequirements(analyzeMarkdown(text)).requirements.map((r) => r.text)).toEqual([
      "Token `--moss`; Hex `#3E5F2A`; Use Header band",
    ]);
  });

  test("splits a long list item into its sentences, each keeping the item's bold lead", () => {
    const long =
      "- **Undo.** The window's undo manager holds the document's steps and every command registers one named step. Each step editor has its own undo manager, separate from the window's. A remote change that rewrites characters clears the undo stack, because a range-based step would land in the wrong place.";
    const texts = extractRequirements(analyzeMarkdown(`# S\n\n## Editor\n\n${long}\n`)).requirements.map((r) => r.text);
    expect(texts).toEqual([
      "Undo: The window's undo manager holds the document's steps and every command registers one named step.",
      "Undo: Each step editor has its own undo manager, separate from the window's.",
      "Undo: A remote change that rewrites characters clears the undo stack, because a range-based step would land in the wrong place.",
    ]);
  });

  test("matches numbered sections by their number", () => {
    const text =
      "# S\n\n## 1. Archive\n\nThe archive keeps recipes for 30 days.\n\n## 9. Checklist circles\n\n### Decisions\n\nThe circle sits at the typed height.\n\n## 10. Find\n\nFind looks inside notes.\n";
    const { requirements } = extractRequirements(analyzeMarkdown(text), { sections: ["9", "10"] });
    expect(requirements.map((r) => r.text)).toEqual([
      "The circle sits at the typed height.",
      "Find looks inside notes.",
    ]);
    expect(extractRequirements(analyzeMarkdown(text), { sections: ["1"] }).requirements.map((r) => r.text)).toEqual([
      "The archive keeps recipes for 30 days.",
    ]);
  });

  test("leaves out a long rejected option and what the code does today", () => {
    const long =
      "- Rejected: `wifi.slash`. In Pantrybook it already means a failed sync (banners, rows, labels) and the status bar, and `icloud.slash` is the account warning, which is not offline mode. A plain word also fits the house rule of plain words. `bolt.slash` reads as a power cut.";
    const text = `# S\n\n## 2. Marker\n\n### Decisions\n\n${long}\n\n## 7. Views\n\n### What is wrong today\n\nThe six views share one segmented control.\n\n### Cause (reproduced off-screen)\n\nThe marker baseline is wrong.\n`;
    expect(extractRequirements(analyzeMarkdown(text)).requirements).toEqual([]);
  });

  test("leaves out an item that says what something is today rather than what to build", () => {
    const text =
      "# S\n\n## 5. Borders\n\n### Decisions\n\n- **What it is:** measured on Priya's screenshot, every card has a line on two edges only.\n- **Fix by construction:** one card style draws every group.\n";
    expect(extractRequirements(analyzeMarkdown(text)).requirements.map((r) => r.text)).toEqual([
      "**Fix by construction:** one card style draws every group.",
    ]);
  });

  test("leaves out the contents list and rejected options", () => {
    const text =
      "# S\n\n## Contents\n\n1. [Archive (old recipes)](#1-archive)\n\n## 3. Duplicates\n\n- **A Duplicates switch** in the List view. Rejected: a sheet or an extra view (new surfaces).\n- Rejected: fuzzy title matching, which calls two different soups the same.\n";
    expect(extractRequirements(analyzeMarkdown(text)).requirements.map((r) => r.text)).toEqual([
      "**A Duplicates switch** in the List view.",
    ]);
  });

  test("leaves out the questions a spike is meant to answer", () => {
    const text = "# S\n\n## Unknowns a short spike answers first\n\n- How many of the sites fall under rule 1.\n";
    expect(extractRequirements(analyzeMarkdown(text)).requirements).toEqual([]);
  });

  test("leaves out measurements, even under a heading that does not start with the word", () => {
    const text = "# S\n\n## Where the time goes (measured 2026-09-17)\n\n- The suite takes 5.8 s one test at a time.\n";
    expect(extractRequirements(analyzeMarkdown(text)).requirements).toEqual([]);
  });
});

describe("condenseDoc", () => {
  test("drops code, then trims the longest sections so every heading survives", () => {
    const md = analyzeMarkdown(
      `# T\n\n## Intent\n\nWhy it exists.\n\n## Big\n\n${"Many words here. ".repeat(300)}\n\n\`\`\`json\n{"a": 1}\n\`\`\`\n\n## Out of scope\n\nPrinting.\n`,
    );
    const condensed = condenseDoc(md, 1_500);
    expect(condensed.length).toBeLessThanOrEqual(1_500);
    expect(condensed).toContain("## Out of scope\n\nPrinting.");
    expect(condensed).toContain("Why it exists.");
    expect(condensed).not.toContain('{"a": 1}');
  });
});
