import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";

const url = process.env.SITE_URL || "http://localhost:8787";
const thresholds = { performance: 95, accessibility: 100, "best-practices": 100, seo: 100 };
await mkdir("audit-results", { recursive: true });
// Lighthouse owns the browser. Attaching Playwright as well distorts the timing.
const chrome = await launch({ chromePath: chromium.executablePath(), chromeFlags: ["--headless=new", "--no-sandbox"] });
try {
  for (const preset of ["mobile", "desktop"]) {
    const result = await lighthouse(url, {
      port: chrome.port,
      logLevel: "error",
      output: ["json", "html"],
      onlyCategories: Object.keys(thresholds),
      ...(preset === "desktop" ? { preset: "desktop" } : {}),
    });
    await writeFile(`audit-results/${preset}.json`, result.report[0]);
    await writeFile(`audit-results/${preset}.html`, result.report[1]);
    const scores = Object.fromEntries(
      Object.entries(result.lhr.categories).map(([name, category]) => [name, Math.round(category.score * 100)]),
    );
    console.log(preset, scores);
    for (const [category, minimum] of Object.entries(thresholds)) {
      if (scores[category] < minimum) {
        process.exitCode = 1;
        console.error(`${preset}: ${category} scored ${scores[category]}, expected at least ${minimum}`);
        console.error(
          result.lhr.categories[category].auditRefs
            .filter(({ id, weight }) => weight > 0 && result.lhr.audits[id].score < 1)
            .map(({ id }) => ({ id, title: result.lhr.audits[id].title, details: result.lhr.audits[id].details })),
        );
      }
    }
  }
} finally {
  await chrome.kill();
}
