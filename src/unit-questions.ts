import type { CodeAnalysis, CodeUnit } from "./code";
import {
  implementsOf,
  OVERBUILT_LEVELS,
  REQUIREMENTS_NOTE,
  REWRITE_NOTE,
  REWRITE_OPTIONS,
  UNIT_BUDGET,
  type Usage,
  withContext,
} from "./code-questions";
import type { Question } from "./jev";
import { clip } from "./run";

export function unitState(
  path: string,
  analysis: CodeAnalysis,
  unit: CodeUnit,
  usage: Map<CodeUnit, Usage>,
  context?: string,
) {
  const own = usage.get(unit);
  return {
    ...withContext(context),
    file: path,
    language: analysis.language,
    unit: {
      name: unit.name,
      kind: unit.kind,
      lines: `${unit.startLine}-${unit.endLine}`,
      code: clip(unit.text, UNIT_BUDGET, "\n[... cut for length ...]"),
    },
    usage: own
      ? { other_files_using_it: own.otherFiles ?? "unknown", uses_elsewhere_in_this_file: own.inThisFile }
      : "unknown",
    ...implementsOf(analysis),
    rest_of_file: analysis.units
      .filter((other) => other !== unit && other.kind !== "imports")
      .map((other) => `${other.name} (${other.kind}, ${other.codeLines} code lines)`),
  };
}

export function unitQuestions(hasContext = false): Record<string, Question> {
  const note = hasContext ? { requirements: REQUIREMENTS_NOTE } : {};
  return {
    overbuilt: {
      type: "score",
      instructions: "How much machinery does `unit.code` use compared with what its job needs?",
      criteria: OVERBUILT_LEVELS,
    },
    rewrite_length: {
      type: "choice",
      instructions: {
        question:
          "If a skilled engineer rewrote `unit.code` to do exactly the same job just as clearly, how long would the rewrite be?",
        note: REWRITE_NOTE,
      },
      criteria: REWRITE_OPTIONS,
    },
    thin_wrapper: {
      type: "noul",
      instructions: {
        question:
          "Is `unit.code` a layer that only forwards to another call with the same arguments, adding nothing but a name?",
        examples_of_yes: [
          "a factory that only calls a constructor: createService(deps) { return new Service(deps) }",
          "a method or function that only delegates to another object: sign(x) { return this.signer.sign(x) }",
          "a class whose methods each call one method of a class it wraps",
        ],
        examples_of_no: [
          "a helper that fixes an argument or setting callers would otherwise repeat, such as a time zone, a format, or a table name",
          "a helper that names a domain idea or a boundary, such as parsing a value read from the database",
          "a function that combines two or more calls",
          "a method that a protocol, interface or base class in `implements` requires, such as a delegate or data source method a framework calls",
        ],
      },
    },
    premature_abstraction: {
      type: "noul",
      instructions: {
        question:
          "Is `unit.code` an abstraction that serves only one concrete case, such as an interface with one implementation, a factory or registry that makes one thing, a base class with one subclass, a strategy object, or a generic parameter that is only ever one type?",
        evidence:
          "`usage` says how many other files use its name, and `rest_of_file` lists what else the file declares.",
        ...note,
      },
    },
    speculative: {
      type: "noul",
      instructions: {
        question:
          "Does `unit.code` accept parameters or options, or handle modes or cases, that nothing appears to need?",
        ...note,
      },
    },
    defensive_excess: {
      type: "noul",
      instructions:
        "Does `unit.code` guard against things that cannot happen, such as null or type checks on values its types or callers already guarantee, try/catch that only logs and rethrows, or fallbacks for impossible states?",
    },
    verbose: {
      type: "noul",
      instructions: "Could `unit.code` do exactly the same job in noticeably fewer lines while staying just as clear?",
    },
    comment_bloat: {
      type: "noul",
      instructions: "Do the comments in `unit.code` mostly restate the code or document the obvious?",
    },
    action: {
      type: "choice",
      instructions: "What should a careful reviewer ask the author to do with `unit.code`?",
      criteria: {
        keep: "Keep it as it is",
        simplify: "Keep it but make it simpler or shorter",
        inline: "Inline it into its callers: it adds a layer without adding logic",
        delete: "Delete it: nothing needs it",
        merge: "Merge it with a similar piece elsewhere in the file",
      },
    },
  };
}
