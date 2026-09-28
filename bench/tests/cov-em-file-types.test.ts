import { extname } from "node:path";
import { expect, it } from "vitest";
import { listProjectFiles } from "./project-files";

const ALLOWED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".css",
  ".html",
  ".json",
  ".jsonc",
  ".md",
  ".sql",
  ".webp",
  ".png",
  ".svg",
  ".woff2",
]);
const ALLOWED_EXACT_PATHS = new Set(["bootstrap", ".gitignore", "public/_headers"]);

// SQL is the only format that also carries a location rule: it may only live in migrations,
// never inline next to application code where it could drift from the applied schema.
function isAllowedFileType(path: string): boolean {
  if (ALLOWED_EXACT_PATHS.has(path)) return true;
  const ext = extname(path);
  if (!ALLOWED_EXTENSIONS.has(ext)) return false;
  return ext !== ".sql" || path.startsWith("migrations/");
}

it("rejects file types and stray SQL outside the matcher's allow-list", () => {
  const paths = [
    "src/a.js",
    "scripts/x.py",
    "deploy.sh",
    "src/b.ts",
    "migrations/0001_x.sql",
    "src/query.sql",
  ];

  expect(paths.filter((path) => !isAllowedFileType(path))).toEqual([
    "src/a.js",
    "scripts/x.py",
    "deploy.sh",
    "src/query.sql",
  ]);
});

it("keeps every project file to an allowed type and location", () => {
  const offenders = listProjectFiles().filter((path) => !isAllowedFileType(path));
  expect(offenders, offenders.join("\n")).toEqual([]);
});
