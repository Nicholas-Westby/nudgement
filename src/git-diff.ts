import type { FileDiff } from "./git";

/** Join numstat totals to unified-diff lines, keeping positions in the new file for later review findings. */
export function parseDiff(diffText: string, numstat: string): FileDiff[] {
  const files = new Map<string, FileDiff>();

  for (const row of numstat.split("\n")) {
    const [added, removed, ...rest] = row.split("\t");
    if (!rest.length) continue;
    const path = normalizeRename(rest.join("\t"));
    files.set(path, {
      path,
      added: added === "-" ? 0 : Number(added),
      removed: removed === "-" ? 0 : Number(removed),
      binary: added === "-",
      lines: [],
    });
  }

  let current: FileDiff | undefined;
  let newLine = 0;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = undefined;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).replace(/^b\//, "");
      if (path === "/dev/null") continue;
      current = files.get(path) ?? { path, added: 0, removed: 0, binary: false, lines: [] };
      files.set(path, current);
      continue;
    }
    if (line.startsWith("--- ")) continue;
    // @@ -oldStart,oldCount +newStart,newCount @@; only newStart is captured.
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (!current) continue;
    const kind = line[0];
    if (kind === "+") current.lines.push({ kind: "+", text: line.slice(1), newLine: newLine++ });
    else if (kind === " ") current.lines.push({ kind: " ", text: line.slice(1), newLine: newLine++ });
    else if (kind === "-") current.lines.push({ kind: "-", text: line.slice(1) });
  }

  return [...files.values()];
}

// numstat prints renames as "old => new" or "dir/{old => new}/file".
function normalizeRename(path: string): string {
  const braces = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(path);
  if (braces) return (braces[1] + braces[3] + braces[4]).replace(/\/\//g, "/");
  const plain = /^(.*) => (.*)$/.exec(path);
  return plain ? plain[2] : path;
}

/** Treat relocated lines as context so moving code does not trigger a new writing review. */
export function withoutMovedLines(files: FileDiff[]): FileDiff[] {
  const removed = new Map<string, number>();
  for (const file of files)
    for (const line of file.lines)
      if (line.kind === "-") removed.set(line.text.trim(), (removed.get(line.text.trim()) ?? 0) + 1);
  return files.map((file) => {
    const lines = file.lines.map((line) => {
      if (line.kind !== "+") return line;
      const key = line.text.trim();
      const left = removed.get(key) ?? 0;
      if (left > 0) removed.set(key, left - 1);
      return left > 0 ? { ...line, kind: " " as const } : line;
    });
    return { ...file, lines, added: lines.filter((line) => line.kind === "+").length };
  });
}
