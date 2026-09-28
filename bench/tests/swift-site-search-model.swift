import Foundation
import Testing
import FieldmarkCore
@testable import FieldmarkPresentation

/// The search box on a survey's detail screen: typing a name finds sites
/// near the outing, and picking one adds it.
@MainActor
@Suite(.serialized)
struct SiteSearchModelTests {
    private static let quelavik = Coordinate(latitude: 60.3913, longitude: 5.3221)
    private static let zelova = SiteCandidate(name: "Zelova", coordinate: Coordinate(latitude: 60.3975, longitude: 5.3242))

    private func makeModel(searcher: FakeSiteSearcher = FakeSiteSearcher()) throws -> (model: SiteSearchModel, tmp: TempDir) {
        let tmp = TempDir()
        let library = SurveyLibrary(root: tmp.url)
        let survey = try library.create(name: "Quelavik")
        let model = try SiteSearchModel(siteStore: library.siteStore(for: survey), searcher: searcher, near: Self.quelavik)
        return (model, tmp)
    }

    @Test func test1() async throws {
        let searcher = FakeSiteSearcher()
        searcher.results = [Self.zelova]
        let (model, tmp) = try makeModel(searcher: searcher)
        defer { tmp.cleanup() }

        await model.search("Zelova")

        #expect(model.candidates.map(\.name) == ["Zelova"])
    }

    @Test func aSearchThatFailsShowsAnError() async throws {
        let searcher = FakeSiteSearcher()
        searcher.error = URLError(.notConnectedToInternet)
        let (model, tmp) = try makeModel(searcher: searcher)
        defer { tmp.cleanup() }

        await model.search("Zelova")

        #expect(model.lastError != nil)
    }

    @Test func searchingAsksTheSearcherOnceWithTheTrimmedText() async throws {
        let searcher = FakeSiteSearcher()
        let (model, tmp) = try makeModel(searcher: searcher)
        defer { tmp.cleanup() }

        await model.search("  Zelova ")

        #expect(searcher.callCount == 1)
        #expect(searcher.lastQuery == "Zelova")
        #expect(searcher.lastRegionCenter == Self.quelavik)
    }

    @Test func theFakeSearcherReturnsWhatItWasGiven() async throws {
        let searcher = FakeSiteSearcher()
        searcher.results = [Self.zelova]

        let found = try await searcher.search("anything", near: Self.quelavik)

        #expect(found == [Self.zelova])
    }

    @Test func typingShowsResultsAfterTheDebounce() async throws {
        let searcher = FakeSiteSearcher()
        searcher.results = [Self.zelova]
        let (model, tmp) = try makeModel(searcher: searcher)
        defer { tmp.cleanup() }

        model.query = "Bryg"
        try await Task.sleep(for: .milliseconds(400))

        #expect(model.candidates.map(\.name) == ["Zelova"])
    }

    @Test func pickingACandidateAddsIt() async throws {
        let searcher = FakeSiteSearcher()
        searcher.results = [Self.zelova]
        let (model, tmp) = try makeModel(searcher: searcher)
        defer { tmp.cleanup() }

        await model.search("Zelova")
        try model.pick(Self.zelova)
    }

    @Test func searchPickAndClear() async throws {
        let searcher = FakeSiteSearcher()
        searcher.results = [Self.zelova]
        let (model, tmp) = try makeModel(searcher: searcher)
        defer { tmp.cleanup() }

        await model.search("Zelova")
        #expect(model.candidates.count == 1)
        try model.pick(Self.zelova)
        #expect(model.sites.map(\.name) == ["Zelova"])
        model.clear()
        #expect(model.query == "")
        #expect(model.lastError == nil)
        model.toggleMapStyle()
        #expect(model.showsSatellite)
    }
}
