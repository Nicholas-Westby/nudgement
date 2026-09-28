import { expect, test } from "bun:test";
import { judgeString, stringQuestions } from "../src/copy-evaluate";
import { extractCopy } from "../src/copy-extract";

const VIEW = `import type { FC } from "hono/jsx";

export const DockPage: FC<{ dock: Dock; bikesLeft: number }> = ({ dock, bikesLeft }) => (
  <main>
    <title>Pedal Commons</title>
    <h1>{dock.street}</h1>
    <p>
      {bikesLeft} bikes left. The dock locks at <strong>{dock.closesAt}</strong> every night.
    </p>
    <img src="/map.svg" alt="Map showing where the dock is" />
    <form method="post">
      <label for="member">Member number</label>
      <input id="member" name="member" placeholder="The eight digits on your key fob" />
      <button type="submit">Unlock a bike</button>
    </form>
    <div role="alert">This dock is empty.</div>
    <a href={\`/docks/\${dock.id}/report\`}>Report a broken bike</a>
    {dock.bikes.map((bike) => (
      <li>{bike.number}</li>
    ))}
    {bikesLeft === 0 ? <p class="error">SORRY, NO BIKES</p> : null}
  </main>
);
`;
test("pulls each user-facing string with its role and line", () => {
  const found = extractCopy("src/views/dock.tsx", VIEW);
  const byText = Object.fromEntries(found.map((item) => [item.text, item]));
  expect(Object.keys(byText)).toEqual([
    "Pedal Commons",
    "{bikesLeft} bikes left. The dock locks at {dock.closesAt} every night.",
    "Map showing where the dock is",
    "Member number",
    "The eight digits on your key fob",
    "Unlock a bike",
    "This dock is empty.",
    "Report a broken bike",
    "SORRY, NO BIKES",
  ]);
  expect(byText["Pedal Commons"].role).toBe("title");
  expect(byText["Unlock a bike"].role).toBe("button");
  expect(byText["Report a broken bike"].role).toBe("link");
  expect(byText["Member number"].role).toBe("label");
  expect(byText["The eight digits on your key fob"].role).toBe("placeholder");
  expect(byText["Map showing where the dock is"].role).toBe("alt");
  expect(byText["This dock is empty."].role).toBe("error");
  expect(byText["SORRY, NO BIKES"].role).toBe("error");
  expect(byText["Unlock a bike"].line).toBe(14);
});

test("leaves out strings that are only an expression, such as {dock.street}", () => {
  expect(extractCopy("a.tsx", VIEW).some((item) => item.text === "{dock.street}" || item.text === "{bike.number}")).toBe(false);
});

test("finds user-facing messages in plain TypeScript", () => {
  const source = `export function parse(input: string) {
  if (!input.trim()) return { ok: false, error: "Enter the hive number." };
  return { ok: true, value: input, label: "Hive" };
}
throw new Error("unreachable state");`;
  const found = extractCopy("src/hive-number.ts", source);
  expect(found.map((item) => [item.text, item.role])).toEqual([
    ["Enter the hive number.", "error"],
    ["Hive", "label"],
  ]);
});


test("applies the exact copy rules without Jev", () => {
  const proper = new Set(["GPS", "Tour", "France"]);
  const rules = (text: string, role: Parameters<typeof judgeString>[0]["role"]) => judgeString({ text, role, line: 1 }, undefined, proper).issues.map((issue) => issue.source);
  expect(rules("NAME", "label")).toEqual(["fact:all-caps"]);
  expect(rules("GPS", "label")).toEqual([]);
  expect(rules("Join This Awesome Ride!", "heading")).toEqual(["fact:title-case", "fact:exclamation"]);
  expect(rules("Tour de France replays", "heading")).toEqual([]);
  expect(rules("Submit", "button")).toEqual(["fact:vague-action"]);
  expect(rules("Unlock a bike", "button")).toEqual([]);
  expect(rules("Oops, error 409", "error")).toEqual(["fact:apology", "fact:jargon"]);
});

test("does not count an acronym as a capitalized word", () => {
  expect(judgeString({ text: "Your API key", role: "label", line: 1 }, undefined, new Set()).issues).toEqual([]);
});

test("takes Apple's title style on Mac buttons, menu items and titles, but not a mix of styles", () => {
  const proper = new Set(["Loomwise", "Mac"]);
  const rules = (text: string, role: Parameters<typeof judgeString>[0]["role"]) => judgeString({ text, role, line: 1 }, undefined, proper, "mac").issues.map((issue) => issue.source);
  expect(rules("Add {count} Fabrics to Favorites", "button")).toEqual([]);
  expect(rules("Delete…", "button")).toEqual([]);
  expect(rules("Add swatch…", "button")).toEqual([]);
  expect(rules("Open Shared Stash", "title")).toEqual([]);
  expect(rules("API Key Needed", "title")).toEqual([]);
  expect(rules("Add New fabric", "button")).toEqual(["fact:mixed-case"]);
  expect(rules("Remove From Favorites", "button")).toEqual(["fact:mixed-case"]);
  expect(rules("Sort Imported Fabrics Automatically", "label")).toEqual(["fact:title-case"]);
  expect(rules("Other / Uncategorized", "option")).toEqual([]);
});

test("calls ALL CAPS shouting, but not an acronym or a sample code in a placeholder", () => {
  const rules = (text: string, role: Parameters<typeof judgeString>[0]["role"]) => judgeString({ text, role, line: 1 }, undefined, new Set(), "mac").issues.map((issue) => issue.source);
  expect(rules("DELETE", "button")).toEqual(["fact:all-caps"]);
  expect(rules("LOOM-…", "placeholder")).toEqual([]);
  expect(rules("URL", "label")).toEqual([]);
});

test("leaves a Mac sheet's standard buttons alone but still flags vague ones", () => {
  const rules = (text: string) => judgeString({ text, role: "button", line: 1 }, undefined, new Set(), "mac").issues.map((issue) => issue.source);
  expect(["Cancel", "Done", "OK", "Save", "Open", "Learn More"].flatMap(rules)).toEqual([]);
  expect(rules("Submit")).toEqual(["fact:vague-action"]);
  expect(rules("Go ({count})")).toEqual(["fact:vague-action"]);
  expect(rules("Click here")).toEqual(["fact:vague-action"]);
});

test("flags a file path or internal file name shown to the reader", () => {
  const rules = (text: string) => judgeString({ text, role: "text", line: 1 }, undefined, new Set()).issues.map((issue) => issue.source);
  expect(rules("Your stash is in ~/Library/Application Support/Loomwise.")).toEqual(["fact:file-path"]);
  expect(rules("Could not read /Volumes/Backup/stash.")).toEqual(["fact:file-path"]);
  expect(rules("share.json could not be read.")).toEqual(["fact:file-path"]);
  expect(rules("Look in .quiltbook/swatches for the originals.")).toEqual(["fact:file-path"]);
  expect(rules("Save it as a .quiltbook file to send it.")).toEqual([]);
  expect(rules("Other / Uncategorized")).toEqual([]);
  expect(rules("Move it into your Applications folder.")).toEqual([]);
});

test("pulls text from component props and sentence-like constants", () => {
  const source = `const MESSAGES = { nameTooLong: "Recipe name is too long.", formatUnknown: "Invalid input." };
const sql = "SELECT id FROM recipes WHERE id = ?";
logger.info("Order accepted for recipe");
export const Form = () => (
  <Layout title="Add New Recipe" path="/recipes/new">
    <Field id="date" label="Date" hint="Orders can be placed up to two weeks ahead." />
  </Layout>
);`;
  const found = extractCopy("src/form.tsx", source).map((item) => [item.text, item.role]);
  expect(found).toEqual([
    ["Recipe name is too long.", "error"],
    ["Invalid input.", "error"],
    ["Add New Recipe", "title"],
    ["Date", "label"],
    ["Orders can be placed up to two weeks ahead.", "text"],
  ]);
});
