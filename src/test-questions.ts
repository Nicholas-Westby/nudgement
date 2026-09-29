import type { Question } from "./jev";

export const TEST_QUESTIONS: Record<string, Question> = {
  user_visible: {
    type: "noul",
    instructions: {
      question:
        "Does `test.code` check behaviour someone outside the code would notice, rather than implementation details?",
      behaviour:
        "a return value, an HTTP response, what appears on the page or screen, what is stored, or what is sent to an outside service such as an API, a database, or a model",
      implementation_details:
        "which internal helper ran, private state, or how many times the code's own functions were called",
    },
  },
  specific: {
    type: "noul",
    instructions:
      "Do the assertions in `test.code` check exact expected values, rather than only that something is truthy, defined or not nil, non-empty, of some type, or matches a snapshot?",
  },
  over_mocked: {
    type: "noul",
    instructions: {
      question: "Does `test.code` mock so much that it mostly checks its own mocks rather than real code?",
      examples_of_yes: [
        "it asserts on a value its own mock returned",
        "it mocks the code's collaborators and asserts only that one of them was or was not called",
      ],
      examples_of_no: [
        "only the outside services, such as the network or a model, are stubs, and it asserts on the result or the messages the real code produced",
      ],
    },
  },
  vacuous: {
    type: "noul",
    instructions: {
      question: "Would `test.code` still pass even if the code it exercises returned wrong results?",
      examples_of_yes: [
        "it asserts only on values the test set up itself, such as a constant",
        "it asserts only on a mock it configured",
        "its assertions cannot fail, such as checking that an object that always exists is truthy or not nil",
      ],
      examples_of_no: [
        "it asserts on the status, body, or return value that the real code produces",
        "it asserts on what the real code sent to a fake or spy that only records it, such as a log line or a saved row",
      ],
    },
  },
  plain_name: {
    type: "noul",
    instructions:
      "Is `test.name` a plain sentence that says what behaviour is expected, the way a person would describe it, rather than a label such as 'test1', 'works', 'should work', or 'handles edge case'?",
  },
  name_matches: {
    type: "noul",
    instructions: "Does `test.code` check what `test.name` says it checks?",
  },
  one_behaviour: {
    type: "noul",
    instructions: "Does `test.code` check one behaviour, rather than several unrelated ones?",
  },
  flaky: {
    type: "noul",
    instructions:
      "Could `test.code` fail at random because it depends on sleeps, timing, the real clock or date, network, or other tests running first?",
  },
  action: {
    type: "choice",
    instructions: "What should a careful reviewer ask for with `test`?",
    criteria: {
      keep: "Keep it as it is",
      tighten: "Keep it but assert exact values",
      rewrite: "Rewrite it to test behaviour through the public interface",
      delete: "Delete it: it cannot fail or tests nothing real",
    },
  },
};

export const TEST_FILE_QUESTIONS: Record<string, Question> = {
  order_dependent: {
    type: "noul",
    instructions:
      "Do tests in `code` depend on running in a particular order, or on state that earlier tests leave behind, such as a shared variable or database rows one test creates for the next?",
  },
  edge_cases: {
    type: "noul",
    instructions:
      "Besides the happy path, does `code` test failures and edge cases, such as invalid input, limits, and error responses?",
  },
  duplicated_setup: {
    type: "noul",
    instructions: "Does `code` repeat the same setup in many tests where a shared helper or fixture would be clearer?",
  },
  overall: {
    type: "score",
    instructions: "How good is `code` as a test file?",
    criteria: [
      "Poor: tests that cannot fail, test internals, or assert almost nothing",
      "Needs work: mostly useful, with weak assertions, over-mocking, or unclear names",
      "Good: behaviour-focused tests with exact assertions and plain names",
      "Excellent: exactly what a careful senior engineer would write",
    ],
  },
};
