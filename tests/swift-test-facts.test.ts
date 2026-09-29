import { expect, test } from "bun:test";
import { testFacts } from "../src/test-parse";

test("counts Swift Testing and XCTest assertions", () => {
  expect(
    testFacts('#expect(a == 1)\ntry #require(b > 2)\n#expect(throws: ParseError.self) { try parse("") }', "swift"),
  ).toMatchObject({ assertions: 3, weak: 0 });
  expect(
    testFacts(
      'XCTAssertEqual(a, 1)\nXCTAssertTrue(done)\nlet v = try XCTUnwrap(x)\nXCTFail("no")\nIssue.record("no")',
      "swift",
    ),
  ).toMatchObject({ assertions: 5 });
  expect(testFacts("expectRoundTrip(original)", "swift")).toMatchObject({ assertions: 1 });
  expect(testFacts('let s = "#expect(x)"\n// XCTAssertEqual(a, b)', "swift")).toMatchObject({ assertions: 0 });
});

test("counts an #expect or #require written with a trailing closure, such as the throws: form", () => {
  expect(
    testFacts("#expect {\n    try decode(notes)\n} throws: { error in\n    failed(error)\n}", "swift").assertions,
  ).toBe(1);
});

test("counts a throwing lookup whose result is thrown away as an assertion, since only its throwing can fail the test", () => {
  expect(testFacts('_ = try view.inspect().find(text: "Rename Shelf")', "swift")).toMatchObject({
    assertions: 1,
    weak: 0,
  });
  expect(
    testFacts(
      '_ = try item("copy-recipe", in: menu)\n_ = await model.load()\ntry store.create(name: "Leeds")',
      "swift",
    ),
  ).toMatchObject({ assertions: 1 });
});

test("counts Swift assertions that only check definedness or non-emptiness as weak", () => {
  const weak = [
    "#expect(model.lastError != nil)",
    "#expect(!results.isEmpty)",
    "#expect(results.count > 0)",
    "#expect(crop is Vegetable)",
    "XCTAssertNotNil(result)",
    "XCTAssertFalse(list.isEmpty)",
    "XCTAssertTrue(value != nil)",
    "let bed = try #require(model.beds.first)",
    "let v = try XCTUnwrap(x)",
  ];
  for (const line of weak) expect(testFacts(line, "swift")).toMatchObject({ assertions: 1, weak: 1 });
  const exact = [
    "#expect(model.lastError == nil)",
    "#expect(results.isEmpty)",
    "#expect(!panel.isLoading)",
    "#expect(results.count == 2)",
    "XCTAssertTrue(model.isSaved)",
    "XCTAssertNil(error)",
    "try #require(list.count == 3)",
    '#expect(text.contains("Leeds"))',
  ];
  for (const line of exact) expect(testFacts(line, "swift")).toMatchObject({ assertions: 1, weak: 0 });
});

test("counts a Swift test's own sleeps, but not a stub's sleep inside a closure", () => {
  expect(testFacts("try await Task.sleep(for: .milliseconds(50))\n#expect(done)", "swift")).toMatchObject({
    sleeps: 1,
  });
  expect(testFacts("Thread.sleep(forTimeInterval: 0.5)\nusleep(1000)\nsleep(1)", "swift")).toMatchObject({ sleeps: 3 });
  expect(
    testFacts(
      "clock.tickSleep = { _ in try await Task.sleep(for: .seconds(60)) }\nlet run = Task {\n  try await Task.sleep(for: .seconds(1))\n}",
      "swift",
    ),
  ).toMatchObject({ sleeps: 0 });
  expect(testFacts("if slow {\n  try await Task.sleep(for: .seconds(1))\n}", "swift")).toMatchObject({ sleeps: 1 });
});

test("does not count a sleep inside a loop that polls for a condition", () => {
  expect(
    testFacts(
      "while model.isResolving, tries < 100 {\n  try await Task.sleep(for: .milliseconds(10))\n  tries += 1\n}",
      "swift",
    ),
  ).toMatchObject({ sleeps: 0 });
  expect(
    testFacts(
      "for _ in 0 ..< 40 where !done() {\n  try await Task.sleep(for: .milliseconds(100))\n}\nrepeat {\n  usleep(1000)\n} while !done()",
      "swift",
    ),
  ).toMatchObject({ sleeps: 0 });
});

test("counts an inverted expectation's wait as a sleep, since it always waits out its timeout", () => {
  expect(
    testFacts('let e = expectation(description: "never")\ne.isInverted = true\nwait(for: [e], timeout: 2)', "swift"),
  ).toMatchObject({ sleeps: 1, assertions: 1 });
  expect(testFacts('let e = expectation(description: "done")\nwait(for: [e], timeout: 2)', "swift")).toMatchObject({
    sleeps: 0,
    assertions: 1,
  });
});

test("counts each Swift fake, stub or spy the test makes as a mock", () => {
  expect(
    testFacts(
      "let forecaster = StubForecaster(answer: leeds)\nlet spy = SpyOrderLogger()\nlet model = Model(forecaster: forecaster)",
      "swift",
    ),
  ).toMatchObject({ mocks: 2 });
});

test("counts reading the real clock in Swift", () => {
  expect(
    testFacts(
      "let now = Date()\nlet later = Date.now.addingTimeInterval(60)\nlet fixed = Date(timeIntervalSince1970: 0)",
      "swift",
    ),
  ).toMatchObject({ realClock: 2 });
});
