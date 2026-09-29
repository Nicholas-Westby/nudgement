import type { CodeAnalysis, CodeUnit } from "./code";
import type { Question } from "./jev";
import { clip } from "./run";

// About 30k tokens. Longer files are judged on their first part and their units.
const CODE_BUDGET = 120_000;

export const UNIT_BUDGET = 24_000;

export interface Usage {
  /** Other files in the repo that mention the name, or null when unknown. */
  otherFiles: number | null;
  inThisFile: number;
}

export const OVERBUILT_LEVELS = [
  "Minimal: about as simple as this job allows",
  "Reasonable: a little extra structure, and each piece earns its place",
  "Heavy: noticeably more layers, options, types, or lines than the job needs",
  "Overbuilt: a small job wrapped in abstractions, options, and ceremony",
];

export const REWRITE_OPTIONS = {
  about_the_same: "90 to 100 percent of the current length",
  somewhat_shorter: "70 to 90 percent of the current length",
  much_shorter: "40 to 70 percent of the current length",
  a_fraction: "Under 40 percent of the current length",
};

export const shrinkOf = (answer: { probabilities: Record<string, number> }) =>
  (answer.probabilities.much_shorter ?? 0) + (answer.probabilities.a_fraction ?? 0);

export const REWRITE_NOTE = "Count only what the job needs. Error handling that real failures need stays in.";

function outlineEntry(unit: CodeUnit, usage: Usage | undefined) {
  return {
    name: unit.name,
    kind: unit.kind,
    lines: `${unit.startLine}-${unit.endLine}`,
    code_lines: unit.codeLines,
    ...(usage
      ? { other_files_using_it: usage.otherFiles ?? "unknown", uses_elsewhere_in_this_file: usage.inThisFile }
      : {}),
  };
}

// Include requirements so mandated behavior is not mistaken for speculative design.
const CONTEXT_BUDGET = 12_000;

export const withContext = (context: string | undefined) =>
  context ? { project_requirements: clip(context, CONTEXT_BUDGET, "\n[... cut ...]") } : {};

export const REQUIREMENTS_NOTE = "Anything `project_requirements` asks for is needed, not speculative or premature.";

// "extension Finder: NSTextFinderClient", "class Store: NSObject, Codable", "class A implements B".
const CONFORMANCE =
  /^\s*(?:(?:public|private|internal|fileprivate|open|final|export|abstract|@[\w.]+)\s+)*(?:class|struct|extension|enum|actor)\s+[\w.]+(?:<[^>]*>)?\s*(?::\s*([^{]+?)|\s+(?:extends|implements)\s+([^{]+?))\s*(?:where\b[^{]*)?\{?\s*$/gm;

/** The protocols, interfaces and base classes a file's types take on, whose required methods a framework calls. */
function conformances(text: string): { implements?: { protocols_and_base_classes: string[]; note: string } } {
  const names = new Set<string>();
  for (const match of text.matchAll(CONFORMANCE)) {
    for (const name of (match[1] ?? match[2]).split(/,|\bimplements\b/)) {
      const clean = name.replace(/@\w+/g, "").replace(/<.*/, "").trim();
      if (/^[A-Z][\w.]*$/.test(clean)) names.add(clean);
    }
  }
  if (!names.size) return {};
  return {
    implements: {
      protocols_and_base_classes: [...names],
      note: "Methods these require are called by a framework or caller outside the file; they cannot be removed or called directly, even when they only pass a value on.",
    },
  };
}

// Every function of a file is sent with the same list, so it is read from the file once.
const implementsByFile = new WeakMap<CodeAnalysis, ReturnType<typeof conformances>>();

export function implementsOf(analysis: CodeAnalysis) {
  let found = implementsByFile.get(analysis);
  if (!found) implementsByFile.set(analysis, (found = conformances(analysis.lines.join("\n"))));
  return found;
}

export function fileState(path: string, analysis: CodeAnalysis, usage: Map<CodeUnit, Usage>, context?: string) {
  const { metrics } = analysis;
  const text = analysis.lines.join("\n");
  return {
    ...withContext(context),
    file: path,
    language: analysis.language,
    facts: {
      lines: metrics.lines,
      code_lines: metrics.codeLines,
      comment_lines: metrics.commentLines,
      functions_and_types: metrics.units,
      longest: metrics.longestUnit ? `${metrics.longestUnit.name}, ${metrics.longestUnit.lines} lines` : null,
      deepest_nesting: metrics.maxDepth,
      try_blocks: metrics.tryBlocks,
      log_calls: metrics.logCalls,
      lines_in_repeated_blocks: metrics.repeatedLines,
    },
    ...implementsOf(analysis),
    outline: analysis.units
      .filter((unit) => unit.kind !== "imports")
      .map((unit) => outlineEntry(unit, usage.get(unit))),
    code: clip(text, CODE_BUDGET, "\n[... rest of the file cut for length ...]"),
  };
}

export function fileQuestions(hasContext = false): Record<string, Question> {
  const note = hasContext ? { requirements: REQUIREMENTS_NOTE } : {};
  return {
    overbuilt: {
      type: "score",
      instructions: "How much machinery does `code` use compared with what its job needs?",
      criteria: OVERBUILT_LEVELS,
    },
    rewrite_length: {
      type: "choice",
      instructions: {
        question:
          "If a skilled engineer rewrote `code` to do exactly the same job just as clearly, how long would the rewrite be?",
        note: REWRITE_NOTE,
      },
      criteria: REWRITE_OPTIONS,
    },
    // Average differently worded bloat questions to reduce dependence on one borderline answer.
    simpler_exists: {
      type: "noul",
      instructions: "Would a skilled engineer do the job of `code` with noticeably less code and fewer moving parts?",
    },
    ceremony: {
      type: "noul",
      instructions:
        "Is a large share of `code` ceremony that does not do the job itself, such as layers, wrapper types, options, redundant checks, logging, or comments?",
    },
    reviewer_simplify: {
      type: "noul",
      instructions: {
        question: "Would a careful senior reviewer ask the author to simplify `code` before merging it?",
        ...note,
      },
    },
    justified_complexity: {
      type: "noul",
      instructions:
        "Is most of the complexity in `code` there because the problem itself is complex, such as real edge cases, performance needs, a protocol or format to follow, or outside constraints?",
    },
    premature_abstraction: {
      type: "noul",
      instructions: {
        question:
          "Does `code` add abstractions that serve only one concrete case, such as an interface with one implementation, a factory or registry that makes one thing, a base class with one subclass, a strategy object, or a generic type parameter that is only ever one type?",
        evidence: "`outline` shows how many other files use each name.",
        ...note,
      },
    },
    speculative_generality: {
      type: "noul",
      instructions: {
        question:
          "Does `code` support options, modes, configuration, hooks, or cases that nothing in it or its callers appears to need yet?",
        ...note,
      },
    },
    defensive_excess: {
      type: "noul",
      instructions:
        "Does `code` guard against things that cannot happen, such as null or type checks on values its own types or callers already guarantee, try/catch blocks that only log and rethrow, or fallbacks for impossible states?",
    },
    duplication: {
      type: "noul",
      instructions: "Does `code` repeat the same logic in several places where one shared piece would do?",
    },
    thin_wrappers: {
      type: "noul",
      instructions:
        "Does `code` contain functions, methods, or classes that only pass their inputs on to another call, adding little or no logic of their own? Methods a protocol, interface or base class in `implements` requires do not count.",
    },
    verbose_logic: {
      type: "noul",
      instructions:
        "Is logic in `code` written longhand where a shorter, equally clear form exists, such as manual loops for built-in operations, long if/else chains a lookup table would replace, or needless temporary variables?",
    },
    comment_bloat: {
      type: "noul",
      instructions:
        "Does `code` carry more comments than it needs, such as doc comments on trivial functions, comments that restate the code, or decorative section banners?",
    },
    dead_code: {
      type: "noul",
      instructions:
        "Does `code` contain dead weight, such as commented-out code, unused functions or variables, or branches that can never run?",
    },
    excess_logging: {
      type: "noul",
      instructions:
        "Does `code` log more than someone running it would need, such as entry and exit logs, a log line for every step, or decorative messages?",
    },
    reinvents_builtin: {
      type: "noul",
      instructions:
        "Does `code` hand-write something that the language's standard library, the platform, or a well-known library already does, such as date arithmetic, parsing or generating a standard format, or encoding?",
    },
    too_many_jobs: {
      type: "noul",
      instructions: "Does `code` do several unrelated jobs that would be clearer as separate files?",
    },
    type_bloat: {
      type: "noul",
      instructions:
        "Does `code` declare more types than its data needs, such as a type or interface for every small shape, wrapper classes around plain values, or an error class hierarchy for one kind of error?",
    },
    ai_style: {
      type: "noul",
      instructions:
        "Does `code` read like code an AI assistant wrote on autopilot: exhaustive doc comments everywhere, defensive checks at every step, enterprise patterns for a small job, and long descriptive names and messages?",
    },
    biggest_problem: {
      type: "choice",
      instructions: "What is the biggest source of unnecessary size or complexity in `code`?",
      criteria: {
        nothing: "Nothing notable: the code is about as lean as the job allows",
        premature_abstraction: "Abstractions that serve one case",
        speculative_generality: "Options or cases nothing needs",
        defensive_excess: "Checks and error handling for things that cannot happen",
        duplication: "Repeated logic",
        thin_wrappers: "Layers that only pass calls through",
        verbose_logic: "Longhand logic where a shorter form exists",
        comment_bloat: "Too many or needless comments",
        dead_code: "Unused or commented-out code",
        excess_logging: "Too much logging",
        reinvents_builtin: "Hand-written versions of built-ins",
        too_many_jobs: "Several unrelated jobs in one file",
        type_bloat: "More types than the data needs",
      },
    },
  };
}
export { unitQuestions, unitState } from "./unit-questions";
