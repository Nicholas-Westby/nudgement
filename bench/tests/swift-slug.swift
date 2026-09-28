import Testing
@testable import FieldmarkCore

@Suite(.serialized)
struct SlugTests {
    @Test func basics() {
        #expect(Slug.make("Paris Outing") == "paris-outing")
        #expect(Slug.make("Café René!") == "cafe-rene")
        #expect(Slug.make("  multiple   spaces ") == "multiple-spaces")
        #expect(Slug.make("") == "untitled")
        #expect(Slug.make("***") == "untitled")
    }

    @Test func disambiguates() {
        #expect(Slug.make("Paris", taken: ["paris"]) == "paris-2")
        #expect(Slug.make("Paris", taken: ["paris", "paris-2"]) == "paris-3")
    }

    @Test func untitledAlsoDisambiguates() {
        #expect(Slug.make("", taken: ["untitled"]) == "untitled-2")
    }

    // Boundary tests: pin exact boundary characters of the a-z / 0-9 ranges.
    // These kill the <= → < and >= → > mutants on the codePoint checks.

    @Test func lowerBoundaryAlphaIsKept() {
        // 'a' (0x61) is the first allowed alpha character.
        // If >= → > fires, 'a' would be treated as a separator instead.
        #expect(Slug.make("a") == "a")
        #expect(Slug.make("abc") == "abc")
    }

    @Test func upperBoundaryAlphaIsKept() {
        // 'z' (0x7A) is the last allowed alpha character.
        // If <= → < fires, 'z' would be treated as a separator instead.
        #expect(Slug.make("z") == "z")
        #expect(Slug.make("xyz") == "xyz")
    }

    @Test func lowerBoundaryDigitIsKept() {
        // '0' (0x30) is the first allowed digit character.
        // If >= → > fires, '0' would be treated as a separator instead.
        #expect(Slug.make("0") == "0")
        #expect(Slug.make("007") == "007")
    }

    @Test func upperBoundaryDigitIsKept() {
        // '9' (0x39) is the last allowed digit character.
        // If <= → < fires, '9' would be treated as a separator instead.
        #expect(Slug.make("9") == "9")
        #expect(Slug.make("99problems") == "99problems")
    }

    @Test func charJustAboveAlphaRangeIsSeparator() {
        // '{' (0x7B) is just above 'z' (0x7A) — must be replaced.
        // ASCII char right above z: 0x7B = '{'
        #expect(Slug.make("{") == "untitled")
        #expect(Slug.make("a{b") == "a-b")
    }

    @Test func charJustBelowDigitRangeIsSeparator() {
        // '/' (0x2F) is just below '0' (0x30) — must be replaced.
        #expect(Slug.make("/") == "untitled")
        #expect(Slug.make("a/b") == "a-b")
    }
}
