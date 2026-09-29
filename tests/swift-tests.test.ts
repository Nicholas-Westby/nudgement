import { expect, test } from "bun:test";
import { findTests, isTestFile } from "../src/test-parse";

const SWIFT_TESTING = `import Testing
@testable import TallyCore

@Suite(.serialized)
struct SlugTests {
    let note = "@Test func notATest() {}"

    @Test func basics() {
        #expect(Slug.make("Spring Harvest") == "spring-harvest")
    }

    // @Test func commentedOut() {}

    @Test("keeps digits at the edge of the range", arguments: ["0", "9"])
    func keepsDigits(value: String) throws {
        #expect(Slug.make(value) == value)
    }

    @MainActor
    @Test(.disabled("waiting on the new weather feed"))
    func forecasts() async throws {
        let forecast = try #require(await lookup("Leeds"))
        #expect(forecast.town == "Leeds")
    }

    struct Nested {
        @Test func \`reads a raw identifier as its name\`() {
            #expect(true == true)
        }
    }
}

@Suite("Tests outside any suite type", .disabled())
struct Parked {
    @Test func parked() {}
}
`;

const XCTEST = `import XCTest
@testable import TallyCore

final class SlugXCTests: XCTestCase {
    func testLowercases() {
        XCTAssertEqual(Slug.make("ABC"), "abc")
    }

    func xtestSkipped() {
        XCTAssertEqual(1, 1)
    }

    func _testAlsoSkipped() {}

    func testHelperWithArguments(_ value: Int) {}

    private func makeSlug() -> String { "" }
}
`;

test("finds Swift Testing tests with display names, arguments, suites and lines", () => {
  const found = findTests(SWIFT_TESTING, "Tests/SlugTests.swift");
  expect(found.map((t) => t.name)).toEqual([
    "basics",
    "keeps digits at the edge of the range",
    "forecasts",
    "reads a raw identifier as its name",
    "parked",
  ]);
  expect(found.map((t) => t.describe)).toEqual([
    ["SlugTests"],
    ["SlugTests"],
    ["SlugTests"],
    ["SlugTests", "Nested"],
    ["Tests outside any suite type"],
  ]);
  expect(found.map((t) => t.modifiers)).toEqual([[], ["arguments"], ["skip"], [], ["skip"]]);
  expect(found[0].startLine).toBe(8);
  expect(found[0].endLine).toBe(10);
  expect(found[1].code.startsWith('@Test("keeps digits')).toBe(true);
  expect(found[1].code.trimEnd().endsWith("}")).toBe(true);
});

test("finds XCTest methods, and reads a leading x or underscore as a disabled test", () => {
  const found = findTests(XCTEST, "Tests/SlugXCTests.swift");
  expect(found.map((t) => t.name)).toEqual(["testLowercases", "xtestSkipped", "_testAlsoSkipped"]);
  expect(found.map((t) => t.modifiers)).toEqual([[], ["skip"], ["skip"]]);
  expect(found[0].describe).toEqual(["SlugXCTests"]);
});

test("ignores test syntax inside Swift strings, multi-line strings and comments", () => {
  const source =
    'let s = """\n@Test func inside() {}\n"""\nlet raw = #"@Test func alsoInside() {}"#\n/* outer /* nested */ @Test func commented() {} */\n@Test func real() { #expect(a == "\\(f("x"))") }\n';
  expect(findTests(source, "Tests/ATests.swift").map((t) => t.name)).toEqual(["real"]);
});

test("recognizes Swift test files by their folder or name and by holding tests", () => {
  expect(isTestFile("Tests/TallyCoreTests/SlugTests.swift", SWIFT_TESTING)).toBe(true);
  expect(isTestFile("TallyTests/SlugXCTests.swift", XCTEST)).toBe(true);
  expect(isTestFile("Sources/TallyCore/SlugTests.swift", SWIFT_TESTING)).toBe(true);
  expect(isTestFile("Sources/TallyCore/Slug.swift", SWIFT_TESTING)).toBe(false);
});

test("treats a Swift helper beside the tests as code, since it holds no tests", () => {
  const helper =
    "import Foundation\n\n/// Used by @Test functions that need a folder.\nstruct TempDir {\n    let url: URL\n    func cleanup() {}\n}\n";
  expect(isTestFile("Tests/TallyCoreTests/TempDir.swift", helper)).toBe(false);
  expect(
    isTestFile(
      "Tests/TallyCoreTests/BaseCase.swift",
      "import XCTest\nclass BaseCase: XCTestCase {\n    func makeModel() {}\n}\n",
    ),
  ).toBe(false);
  expect(isTestFile("Tests/TallyCoreTests/SlugTests.swift")).toBe(false);
});
