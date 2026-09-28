import Testing
@testable import FieldmarkServices

/// The one way the app joins the parts of a sentence that lists things.
@Suite(.serialized)
struct SpokenListTests {
    @Test func nothingIsNothing() {
        #expect(SpokenList.joined([]) == "")
    }

    @Test func oneThingStandsAlone() {
        #expect(SpokenList.joined(["a photo"]) == "a photo")
    }

    @Test func twoThingsAreJoinedWithAndAlone() {
        #expect(SpokenList.joined(["a photo", "a file"]) == "a photo and a file")
    }

    /// No comma before the "and": the house style every existing sentence has.
    @Test func moreThingsAreCommaedUpToTheLastAnd() {
        #expect(SpokenList.joined(["Louvre", "Arch", "Orsay"]) == "Louvre, Arch and Orsay")
    }
}
