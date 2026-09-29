import { T } from "./commit-rules";
import { type Answers, choice, noul, score } from "./jev";
import type { Issue, ParsedMessage } from "./message";
import { fmt, jevSource, reader } from "./run";

export function judgeAccuracy(
  parsed: ParsedMessage,
  answers: Answers,
  readings: Record<string, unknown>,
  diff: { diffCut: boolean; oneNewFile: boolean; houseScope: boolean },
): Issue[] {
  const issues: Issue[] = [];
  const get = reader(answers, readings);
  const issue = (severity: Issue["severity"], part: string, message: string, key: string, value: number) =>
    issues.push({ severity, part, message, source: jevSource(key, value) });

  const typeFits = get("type_fits");
  const best = choice(answers, "best_type");
  readings.best_type = { choice: best.choice, confidence: best.confidence, probabilities: best.probabilities };
  // Type-fit alone produces false alarms; require a confident alternative before failing.
  const prefersOther = best.choice !== parsed.type && best.confidence >= T.bestTypeConfidence;
  const suggestion = prefersOther ? ` Consider "${best.choice}".` : "";
  const ownTypeClear = !!parsed.type && (best.probabilities[parsed.type] ?? 0) >= T.ownTypeClear;
  if (!ownTypeClear && parsed.type && (typeFits < T.typeFitsError || (prefersOther && typeFits < T.typeFitsWarn))) {
    issue("error", "type", `The type "${parsed.type}" does not fit this change.${suggestion}`, "type_fits", typeFits);
  } else if (!ownTypeClear && parsed.type && typeFits < T.typeFitsWarn) {
    issue("warn", "type", `The type "${parsed.type}" may not fit this change.${suggestion}`, "type_fits", typeFits);
  }

  const accurate = get("subject_accurate");
  const main = get("subject_main_change");
  // Corroborate borderline accuracy readings with unsupported claims or a missed main change.
  const backed =
    answers.claims_unsupported && (noul(answers, "claims_unsupported") >= 0.4 || main < 0.4 || accurate < 0.2);
  if (accurate < T.subjectAccurateError && backed)
    issue("error", "subject", "The subject does not describe what the diff does.", "subject_accurate", accurate);
  // Where the diff was cut, Jev cannot see all the subject describes: 5 of 47 such
  // runs drew this warning, against 2% of whole diffs, and all 5 were accurate.
  else if (accurate < T.subjectAccurateWarn && !diff.diffCut)
    issue("warn", "subject", "The subject may not match what the diff does.", "subject_accurate", accurate);
  if (main < T.mainChangeWarn)
    issue(
      "warn",
      "subject",
      "The subject names a side detail. Lead with the main change.",
      "subject_main_change",
      main,
    );

  const specificity = score(answers, "subject_specificity");
  readings.subject_specificity = specificity.score;
  if (specificity.score < T.subjectSpecificityWarn) {
    issues.push({
      severity: "warn",
      part: "subject",
      message: "The subject is vague. Say what changed and where.",
      source: `jev:subject_specificity=${fmt(specificity.score)}/3`,
    });
  }

  const unsupported = get("claims_unsupported");
  if (unsupported > T.unsupportedError)
    issue("error", "body", "The message claims something the diff does not show.", "claims_unsupported", unsupported);
  else if (unsupported > T.unsupportedWarn)
    issue("warn", "body", "The message may claim something the diff does not show.", "claims_unsupported", unsupported);
  const omits = get("omits_major_change");
  if (omits > T.omitsWarn)
    issue(
      "warn",
      "body",
      "The diff has a significant change the message does not mention.",
      "omits_major_change",
      omits,
    );
  const lists = get("lists_files");
  if (lists > T.listsFilesWarn)
    issue("warn", "body", "Lists edits one by one. Summarize the change instead.", "lists_files", lists);
  const split = get("should_split");
  // One new file, such as a design document, is one piece of work however many topics it covers.
  if (split > T.splitWarn && !diff.oneNewFile)
    issue(
      "warn",
      "commit",
      "The diff seems to hold unrelated changes. Consider separate commits.",
      "should_split",
      split,
    );

  const why = choice(answers, "why_given");
  readings.why_given = { choice: why.choice, probabilities: why.probabilities };
  if (why.choice === "why_missing" && why.confidence > 0.6) {
    issues.push({
      severity: "info",
      part: "body",
      message: "A reviewer would want to know why. Consider one bullet with the reason.",
      source: `jev:why_given=why_missing@${fmt(why.confidence)}`,
    });
  }

  const bullets = choice(answers, "bullet_count");
  readings.bullet_count = { choice: bullets.choice, probabilities: bullets.probabilities };
  if (bullets.choice !== "right" && bullets.confidence > T.bulletCountWarn) {
    const text =
      bullets.choice === "fewer"
        ? "Use fewer bullets; some do not earn their place."
        : "Add a bullet: something a reviewer needs is missing.";
    issues.push({
      severity: bullets.choice === "fewer" ? "warn" : "info",
      part: "body",
      message: text,
      source: `jev:bullet_count=${bullets.choice}@${fmt(bullets.confidence)}`,
    });
  }

  if (parsed.scope) {
    const fits = get("scope_fits");
    const assessment = choice(answers, "scope_assessment");
    readings.scope_assessment = { choice: assessment.choice, probabilities: assessment.probabilities };
    // A scope earlier commits to these files use is the repo's own name for them.
    if (fits < T.scopeFitsWarn && !diff.houseScope) {
      const why = assessment.choice === "fits" ? "" : ` It looks ${assessment.choice.replace("_", " ")}.`;
      issue("warn", "scope", `The scope "${parsed.scope}" does not fit the area changed.${why}`, "scope_fits", fits);
    }
  } else {
    const needed = get("scope_needed");
    if (needed > T.scopeNeededInfo)
      issue("info", "scope", "The change sits in one clear area. A scope would help.", "scope_needed", needed);
  }

  parsed.bullets.forEach((_, index) => {
    const n = index + 1;
    const accurateKey = `bullet_${n}_accurate`;
    const value = get(accurateKey);
    if (value < T.bulletAccurateError)
      issue("error", `bullet ${n}`, `Bullet ${n} describes a change the diff does not make.`, accurateKey, value);
    const infoKey = `bullet_${n}_adds_info`;
    const adds = get(infoKey);
    if (adds < T.bulletAddsInfoWarn)
      issue("warn", `bullet ${n}`, `Bullet ${n} adds little beyond the subject. Consider dropping it.`, infoKey, adds);
  });

  const overall = score(answers, "overall");
  readings.overall = overall.score;
  const weakest = choice(answers, "weakest_part");
  readings.weakest_part = {
    choice: weakest.choice,
    confidence: weakest.confidence,
    probabilities: weakest.probabilities,
  };
  if (weakest.choice !== "nothing") {
    issues.push({
      severity: "info",
      part: weakest.choice.replace("_", " "),
      message: `Most in need of improvement: ${weakest.choice.replace("_", " ")}.`,
      source: `jev:weakest_part=${weakest.choice}@${fmt(weakest.confidence)}`,
    });
  }
  return issues;
}
