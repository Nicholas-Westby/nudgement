import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { benchClarity } from "./scripts/suites/clarity";
import { benchComments, benchCommits, benchContradictions, benchHistory } from "./scripts/suites/commits";
import { args, BENCH, manifests, RESULTS } from "./scripts/suites/common";
import { benchCopy } from "./scripts/suites/copy";
import { benchDesigns } from "./scripts/suites/designs";
import { benchFiles, benchReadmes } from "./scripts/suites/files";
import { benchPlanCoverage, benchPlans } from "./scripts/suites/plans";
import { benchProse } from "./scripts/suites/prose";
import { sweep } from "./scripts/suites/sweep";
import { benchCoverage, benchTests } from "./scripts/suites/tests";
import { CODE_THRESHOLDS } from "./src/code-evaluate";
import { COPY_THRESHOLDS } from "./src/copy-evaluate";
import { DESIGN_THRESHOLDS } from "./src/design-evaluate";
import { THRESHOLDS } from "./src/evaluate";
import { HISTORY_THRESHOLDS } from "./src/history";
import { PLAN_THRESHOLDS } from "./src/plan-evaluate";
import { README_THRESHOLDS } from "./src/readme-evaluate";
import { TEST_THRESHOLDS } from "./src/test-evaluate";

export async function runBench(suites: string[] = []) {
  const run = (name: string) => !suites.length || suites.includes(name);
  const saved: Record<string, unknown> = {
    at: new Date().toISOString(),
    thresholds: {
      commit: THRESHOLDS,
      code: CODE_THRESHOLDS,
      readme: README_THRESHOLDS,
      tests: TEST_THRESHOLDS,
      copy: COPY_THRESHOLDS,
      history: HISTORY_THRESHOLDS,
      design: DESIGN_THRESHOLDS,
      plan: PLAN_THRESHOLDS,
    },
  };
  // One at a time, so each suite's report prints in one piece.
  if (run("commits") && existsSync(join(BENCH, "commits.json"))) saved.commits = await benchCommits();
  if (run("comments") && existsSync(join(BENCH, "comments.json"))) saved.comments = await benchComments();
  if (run("contradictions") && existsSync(join(BENCH, "contradictions.json")))
    saved.contradictions = await benchContradictions();
  if (run("files") && manifests("files").length) saved.files = await benchFiles();
  if (run("clarity")) saved.clarity = await benchClarity();
  if (run("readmes") && manifests("readmes").length) saved.readmes = await benchReadmes();
  if (run("tests") && existsSync(join(BENCH, "tests.json"))) saved.tests = await benchTests();
  if (run("coverage") && existsSync(join(BENCH, "tests-coverage.json"))) saved.coverage = await benchCoverage();
  if (run("prose")) saved.prose = await benchProse();
  if (run("copy") && existsSync(join(BENCH, "copy.json"))) saved.copy = await benchCopy();
  if (run("history") && existsSync(join(BENCH, "history.json"))) saved.history = await benchHistory();
  if (run("designs") && existsSync(join(BENCH, "designs.json"))) saved.designs = await benchDesigns();
  if (run("plans") && existsSync(join(BENCH, "plans.json"))) saved.plans = await benchPlans();
  if (run("plan-coverage") && existsSync(join(BENCH, "plan-coverage.json")))
    saved.planCoverage = await benchPlanCoverage();
  return saved;
}

if (import.meta.main) {
  if (args.includes("--sweep")) sweep(args[args.indexOf("--sweep") + 1]);
  else {
    const { installReplay } = await import("./scripts/jev-replay");
    const replay = installReplay(process.env.JEV_REPLAY_SAMPLE ?? "0");
    const saved = await runBench(args);
    replay.assertComplete();
    mkdirSync(RESULTS, { recursive: true });
    const out = join(RESULTS, `${saved.at as string}.json`.replace(/:/g, "-"));
    writeFileSync(out, JSON.stringify(saved, null, 1));
    console.log(`Saved readings to ${out}`);
  }
}
