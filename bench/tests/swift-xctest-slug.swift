import XCTest
@testable import FieldmarkCore

/// The folder name a survey is saved under, from the name the user typed.
final class SlugXCTests: XCTestCase {
    func testLowercasesAndJoinsWordsWithHyphens() {
        XCTAssertEqual(Slug.make("Paris Outing"), "paris-outing")
        XCTAssertEqual(Slug.make("  multiple   spaces "), "multiple-spaces")
    }

    func testFoldsAccentsToPlainLetters() {
        XCTAssertEqual(Slug.make("Café René"), "cafe-rene")
    }

    func testAddsTheNextFreeNumberWhenTheNameIsTaken() {
        XCTAssertEqual(Slug.make("Paris", taken: ["paris", "paris-2"]), "paris-3")
    }

    func testWorks() {
        let slug = Slug.make("Paris Outing")
        XCTAssertNotNil(slug)
        XCTAssertFalse(slug.isEmpty)
    }

    func testMakesASlugForPunctuation() {
        let slug = Slug.make("***")
        XCTAssertTrue(slug.count > 0)
    }
}
