import { describe, expect, test } from "bun:test";
import { analyzeMarkdown } from "../src/markdown";
import { findTasks, fitText, planHeader, planningDocKind, planPlaceholders, rankTasks, specSectionsNamed, taskExcerpt, taskFacts } from "../src/plan-parse";

const PLAN = `# Pre-flight checklist Implementation Plan

**Goal:** A pre-flight checklist per glider.

**Spec:** \`docs/superpowers/specs/2026-09-25-checklist-design.md\`, sections "What people see" and "Saving".

## Global Constraints

- Run the tests with \`./Scripts/test.sh\`.

### Task 1: The item model

**Files:**
- Create: \`Sources/Core/ChecklistItem.swift\`
- Test: \`Tests/CoreTests/ChecklistItemTests.swift\`

- [ ] **Step 1: Write the failing test**

\`\`\`swift
@Test func tickingMovesAnItemDown() {
    #expect(list.ticked("Canopy").items.last?.name == "Canopy")
}
\`\`\`

- [ ] **Step 2: Run it to see it fail**

Run: \`./Scripts/test.sh --filter ChecklistItemTests\`
Expected: FAIL with "cannot find ChecklistItem"

- [ ] **Step 3: Implement**

\`\`\`swift
struct ChecklistItem { var name: String; var checked = 0...1 }
\`\`\`

- [ ] **Step 4: Run it to see it pass.**

### Task 2: Saving

**Files:** Modify \`Sources/Core/ChecklistStore.swift\`.

- [ ] **Step 1: Implement** saving, similar to Task 1.

\`\`\`swift
func save() {
    ...
}
\`\`\`

- [ ] **Step 2:** Add appropriate error handling and handle edge cases.
- [ ] **Step 3:** Write tests for the above.

### Task 3: Docs

Update the README.

## Done when

- Everything passes.
`;

describe("findTasks", () => {
  test("finds Task N headings and ends each at the next heading of its level or above", () => {
    const tasks = findTasks(analyzeMarkdown(PLAN));
    expect(tasks.map((t) => t.title)).toEqual(["Task 1: The item model", "Task 2: Saving", "Task 3: Docs"]);
    expect(tasks[2].text).not.toContain("Done when");
    expect(tasks[0].text).toContain("Step 4");
  });

  test("accepts lettered tasks such as Task 7b and ignores headings inside code blocks", () => {
    const text = "# P\n\n### Task 7: A\n\ntext\n\n```sh\n# Task 8: not a heading\n```\n\n### Task 7b: B\n\ntext\n";
    expect(findTasks(analyzeMarkdown(text)).map((t) => t.title)).toEqual(["Task 7: A", "Task 7b: B"]);
  });

  test("falls back to numbered headings when there are no Task headings", () => {
    const text = "# P\n\n## Goal\n\nx\n\n## 1. Model\n\nx\n\n## 2. Store\n\nx\n";
    expect(findTasks(analyzeMarkdown(text)).map((t) => t.title)).toEqual(["1. Model", "2. Store"]);
  });
});

describe("taskFacts", () => {
  const [one, two, three] = findTasks(analyzeMarkdown(PLAN));

  test("reads the files, the failing test before the implementation, and a command with its expected result", () => {
    const facts = taskFacts(one);
    expect(facts.files).toEqual(["Sources/Core/ChecklistItem.swift", "Tests/CoreTests/ChecklistItemTests.swift"]);
    expect(facts.test).toBe("before");
    expect(facts.command).toBe("./Scripts/test.sh --filter ChecklistItemTests");
    expect(facts.expected).toBe(true);
  });

  test("a test step after the implementation is reported as after", () => {
    expect(taskFacts(two).test).toBe("after");
  });

  test("adding tests or UI tests after the implementation is also after", () => {
    const text = (step: string) => `# P\n\n### Task 4: Keys\n\n- [ ] **Step 1: Implement** the keys.\n- [ ] **Step 2: ${step}** for the keys.\n`;
    expect(taskFacts(findTasks(analyzeMarkdown(text("Add tests")))[0]).test).toBe("after");
    expect(taskFacts(findTasks(analyzeMarkdown(text("Write UI tests")))[0]).test).toBe("after");
  });

  test("a task with no test, file or command says so", () => {
    const facts = taskFacts(three);
    expect(facts.test).toBe("none");
    expect(facts.files).toEqual([]);
    expect(facts.command).toBeUndefined();
  });

  test("a task that says why it has no test is marked as explained", () => {
    const text = "# P\n\n### Task 6: Write it to disk\n\n- [ ] **Step 1: Write the implementation**\n\nThere is no unit test for this one: it is filesystem plumbing, and Task 7 proves it.\n";
    const facts = taskFacts(findTasks(analyzeMarkdown(text))[0]);
    expect(facts.test).toBe("none");
    expect(facts.noTestExplained).toBe(true);
    expect(taskFacts(three).noTestExplained).toBe(false);
  });

  test("a test suite named in the Files line is a file and a test", () => {
    const text = "# P\n\n### Task 5: Two ledgers\n\n**Files:** Add cases to the two-ledger `LedgerMergeIntegrationTests` (it merges two ledgers).\n\n- [ ] **Step 1–4**\n";
    const facts = taskFacts(findTasks(analyzeMarkdown(text))[0]);
    expect(facts.files).toEqual(["LedgerMergeIntegrationTests"]);
    expect(facts.test).toBe("before");
  });

  test("a step that proves the work by hand marks a task without tests as verified", () => {
    const text = "# P\n\n### Task 13: Seed data\n\n**Files:**\n- Create: `scripts/seed.ts`\n\n- [ ] **Step 1: Write the seed script**\n- [ ] **Step 2: Prove it** — delete the database, run `./bootstrap`, and check the menu shows the dishes.\n";
    expect(taskFacts(findTasks(analyzeMarkdown(text))[0]).verified).toBe(true);
    expect(taskFacts(three).verified).toBe(false);
  });

  test("a task that creates spec files is a test task, and a Run step verifies it", () => {
    const text = "# P\n\n### Task 15: Audits\n\n**Files:**\n\n- Create: `tests/e2e/accessibility.spec.ts`\n\n- [ ] **Step 1: Pa11y** — one test per page.\n- [ ] **Step 3: Run, fix, commit**\n";
    const facts = taskFacts(findTasks(analyzeMarkdown(text))[0]);
    expect(facts.test).toBe("before");
    expect(facts.verified).toBe(true);
  });

  const facts = (body: string, title = "Task 7: Cards") => taskFacts(findTasks(analyzeMarkdown(`# P\n\n### ${title}\n\n${body}\n`))[0]);

  test("terse bullets that name tests count as a test step", () => {
    for (const line of [
      "- Tests (`StarredControlsTests` + a pixel test): badge only on starred hives.",
      "- Tests: `SwatchModelTests` (every swatch carries the flag), ViewInspector badge presence.",
      "- Test `UnitLabelCoverageTests` (source scan), red first by scanning before the labels exist.",
      "- Pixel test (`CardSectionTests`): the hairline is there on every side.",
      "- `RecipeEditorView`: two columns. Update `RecipeEditorLayoutTests` (`.form(0)` → the column's id).",
      "Edits the document through `shouldChangeText`. Test: Replace All leaves the recipe steps as they were.",
      "- `SettingsSheet`: cards. Update Settings tests and `AppSnapshots` wrappers.",
    ]) expect(facts(line).test).toBe("before");
  });

  test("a task that says it has no unit test has none, even if it names a test suite", () => {
    const f = facts("There is no unit test for this one: it is plumbing. It copies `LedgerCoreTests` into the sandbox.");
    expect(f.test).toBe("none");
    expect(f.noTestExplained).toBe(true);
  });

  test("a live check, a spike or a milestone task counts as checked by hand", () => {
    expect(facts("Build, launch and drive it with real keys; take screenshots.", "Task 5: §9 live check").verified).toBe(true);
    expect(facts("Settle what the research could not, then throw it away.", "Task 6: spike (throwaway, not committed)").verified).toBe(true);
    expect(facts("Help paragraph, then the live check.", "Task 18: Help, live check, milestone").verified).toBe(true);
    expect(facts("- `AddMemberSheet`: one `CardSection`.\n\n**Live check (§5):** editor and Settings before and after, light and dark.", "Task 22: Add Member").verified).toBe(true);
  });

  test("backticked type names count as files named", () => {
    expect(facts("- `SettingsSheet` + sections: `CardForm` inside the `ScrollViewReader`.").files).toEqual(["SettingsSheet", "CardForm", "ScrollViewReader"]);
    expect(facts("`shouldReplaceCharacters(inRanges:with:)` answers false.").files).toEqual([]);
  });

  test("a red step before a green one counts as a failing test first", () => {
    const f = facts("**Files:** `Sources/A.swift`; tests `Tests/ATests.swift`.\n\n- [ ] Red: a deleted recipe round-trips with its record.\n- [ ] Green: add the record.\n- [ ] Commit `feat(core): add it`.");
    expect(f.test).toBe("before");
  });

  test("a test file named with its extension in the files counts as a test", () => {
    expect(facts("**Files:** `Sources/A.swift`; tests `Tests/ControlApiArchiveTests.swift` (new).\n\n- [ ] `restore-recipe` puts the recipe back.").test).toBe("before");
  });

  test("a task whose only file is a test file counts as test first", () => {
    expect(facts("**Files:** `Tests/LedgerPresentationTests/TwoTillsTests.swift` (new).\n\n- [ ] A voids a sale; B no longer shows it.").test).toBe("before");
  });

  test("a gates task that runs the test suite counts as checked", () => {
    expect(facts("- [ ] Full `./Scripts/test.sh`; `./Scripts/lint.sh`, then `git diff`.", "Task 18: Gates").verified).toBe(true);
  });

  test("tests named in prose count as a failing-test step", () => {
    const text = "# P\n\n### Task 1: X\n\n**Files:** Create `A.swift`. Test: `ATests.swift`.\n\n- [ ] **Step 1: Failing tests:** `returnContinuesAList`, `tabIndents`.\n- [ ] **Step 2–4.**\n";
    expect(taskFacts(findTasks(analyzeMarkdown(text))[0]).test).toBe("before");
  });
});

describe("planPlaceholders", () => {
  test("finds the placeholder phrases and elided code, but not a range operator", () => {
    const [one, two] = findTasks(analyzeMarkdown(PLAN));
    expect(planPlaceholders(one)).toEqual([]);
    const found = planPlaceholders(two).map((p) => p.rule);
    expect(found).toEqual(["similar-task", "elided-code", "error-handling", "edge-cases", "tests-for-above"]);
  });

  test("keeps a concrete edge case list and an existing-code marker", () => {
    const text = "# P\n\n### Task 1: X\n\nHandle edge cases: an empty list, a 500-character name.\n\n```ts\n// ... existing code ...\nfoo();\n```\n";
    expect(planPlaceholders(findTasks(analyzeMarkdown(text))[0])).toEqual([]);
  });
});

describe("planHeader", () => {
  test("reads the goal and the spec sections the plan names", () => {
    const header = planHeader(PLAN);
    expect(header.goal).toBe("A pre-flight checklist per glider.");
    expect(header.spec).toContain("checklist-design.md");
  });

  test("reads a Spec line that wraps onto the next line", () => {
    const header = planHeader("# P\n\n**Spec:** `x-design.md`, sections 2, 4\n(and 13, the rules).\n\n**Goal:** G.\n");
    expect(header.spec).toBe("`x-design.md`, sections 2, 4 (and 13, the rules).");
  });
});

describe("specSectionsNamed", () => {
  test("reads quoted section names and parts from the Spec line", () => {
    expect(specSectionsNamed('`x-design.md`, sections "What people see", "Editor", "Model and persistence".')).toEqual(["What people see", "Editor", "Model and persistence"]);
    expect(specSectionsNamed('`x-design.md`, part 2 and the "Spike findings (2026-09-17)" section at the end.')).toEqual(["Part 2", "Spike findings (2026-09-17)"]);
    expect(specSectionsNamed("`x-design.md`")).toBeUndefined();
  });

  test("reads numbered sections, including ones in parentheses and after a section sign", () => {
    expect(specSectionsNamed("`docs/2026-09-27-settings-batch-design.md`, sections 2, 4, 5, 6, 7, 8 (and 13, the rules for every group)")).toEqual(["2", "4", "5", "6", "7", "8", "13"]);
    expect(specSectionsNamed("`docs/2026-09-27-settings-batch-design.md` §9 and §10. Research: `grounding/field-notes.md` sections 1 and 2.")).toEqual(["9", "10"]);
  });
});

describe("rankTasks and taskExcerpt", () => {
  const tasks = findTasks(analyzeMarkdown(PLAN));

  test("ranks tasks by the requirement's rarer words", () => {
    const ranked = rankTasks("Ticking an item moves it to the bottom (ChecklistItem)", tasks);
    expect(ranked[0].task.title).toBe("Task 1: The item model");
    expect(rankTasks("Each change is saved within one second", tasks)[0].task.title).toBe("Task 2: Saving");
  });

  test("counts the requirement's words in a task's title more than in its body", () => {
    const text = "# P\n\n### Task 3: Spinners keep their size\n\nThe button keeps the view steady; the button spins.\n\n### Task 11: One toolbar button per view\n\nA toggle for each mode.\n";
    expect(rankTasks("Each view gets its own button and its own word.", findTasks(analyzeMarkdown(text)))[0].task.title).toBe("Task 11: One toolbar button per view");
  });

  test("does not rank on a bare section reference such as §12", () => {
    const text = "# P\n\n### Task 3: Ratings hook\n\nRatings (§12) reuse the badge.\n\n### Task 11: One toolbar button per view\n\nEach view gets its own toolbar button with its own word.\n";
    expect(rankTasks("Each view gets its own button, and so its own word: Ratings (§12) adds a seventh.", findTasks(analyzeMarkdown(text)))[0].task.title).toBe("Task 11: One toolbar button per view");
  });

  test("puts a task that repeats a symbol-bearing token such as a shortcut first", () => {
    const text = "# P\n\n### Task 1: Card backs\n\nEach card back is a back of text; the back scrolls.\n\n## Global Constraints\n\n- Shortcuts: Front ⇧⌘F, Back ⇧⌘B.\n";
    const md = analyzeMarkdown(text);
    const rules = { title: "Global Constraints", level: 2, startLine: 7, endLine: 9, text: md.lines.slice(6).join("\n") };
    expect(rankTasks("Back: ⇧⌘B", [...findTasks(md), rules])[0].task.title).toBe("Global Constraints");
  });

  test("puts a task that uses the requirement's exact code span first", () => {
    const text = "# P\n\n### Task 1: Exporting\n\nExporting notes, exporting rows, exporting steps, test scripts for exporting, exporting test steps.\n\n### Task 2: Scripts\n\nAdd a step to `Scripts/test-exporting.sh`.\n";
    const ranked = rankTasks("`Scripts/test-exporting.sh` gains an exporting step", findTasks(analyzeMarkdown(text)));
    expect(ranked[0].task.title).toBe("Task 2: Scripts");
  });

  test("an excerpt within budget is the task itself, and a long one keeps the heading and the matching parts", () => {
    expect(taskExcerpt(tasks[0], ["ticking"], 10_000)).toBe(tasks[0].text);
    const long = { ...tasks[0], text: tasks[0].text + "\n\n" + "Unrelated padding line about nothing.\n\n".repeat(400) + "The zebra rule lives here.\n" };
    const excerpt = taskExcerpt(long, ["zebra"], 1_500);
    expect(excerpt.length).toBeLessThanOrEqual(1_600);
    expect(excerpt).toContain("### Task 1: The item model");
    expect(excerpt).toContain("zebra");
  });
});

describe("fitText", () => {
  test("fitText leaves short text alone and shortens long code blocks before cutting prose", () => {
    expect(fitText("short", 100)).toBe("short");
    const code = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const text = `Keep this sentence.\n\n\`\`\`swift\n${code}\n\`\`\`\n\nAnd this one.`;
    const fitted = fitText(text, 800);
    expect(fitted.length).toBeLessThanOrEqual(800);
    expect(fitted).toContain("Keep this sentence.");
    expect(fitted).toContain("And this one.");
    expect(fitted).toMatch(/more lines of code/);
  });
});

describe("planningDocKind", () => {
  test("names the superpowers specs and plans, and any *-design.md, and nothing else", () => {
    expect(planningDocKind("docs/superpowers/specs/2026-09-27-settings-batch-design.md")).toBe("design");
    expect(planningDocKind("notes/cache-design.md")).toBe("design");
    expect(planningDocKind("docs/superpowers/plans/2026-09-27-archive.md")).toBe("plan");
    expect(planningDocKind(".superpowers/plans/2026-09-26-tide-alerts-plan.md")).toBe("plan");
    expect(planningDocKind(".superpowers/plans/2026-09-26-tide-alerts-design.md")).toBe("design");
    expect(planningDocKind("docs/superpowers/plans/run.json")).toBeUndefined();
    expect(planningDocKind("README.md")).toBeUndefined();
  });
});
