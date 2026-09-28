import Foundation
import Testing
import FieldmarkCore
@testable import FieldmarkPresentation

/// Visit Info's panel belongs to the detail model, not to the sheet.
///
/// The sheet used to build its panel inside its own content closure, and
/// SwiftUI re-runs that closure on every redraw of the detail screen: one
/// redraw swapped the resolving panel for a fresh empty one whose lookup never
/// ran, and a sheet that had shown Norway said "No Visit Info".
///
/// Here rather than in `Tests/FieldmarkUITests`, where these started:
/// ``SurveyDetailModel`` is a `FieldmarkPresentation` type, and only that
/// module's own test target can judge one.
@MainActor
@Suite(.serialized)
struct VisitInfoPresentationTests {
    private struct Fixture {
        let tmp: TempDir
        let library: SurveyLibrary
        let model: SurveyDetailModel
    }

    private static let zelova = Coordinate(latitude: 60.3975, longitude: 5.3242)
    private static let opera = Coordinate(latitude: 59.9075, longitude: 10.7531)
    private static let norway = AdminPlacemark(countryCode: "NO", country: "Norway")

    /// Two sites in Norway and one with nowhere to be.
    private func makeFixture() throws -> Fixture {
        let tmp = TempDir()
        let library = SurveyLibrary(root: tmp.url)
        let survey = try library.create(name: "Norway")
        let store = try library.siteStore(for: survey)
        try store.create(name: "Zelova", coordinate: Self.zelova)
        try store.create(name: "Obborn Opera House", coordinate: Self.opera)
        try store.create(name: "Somewhere Nice")
        let model = try SurveyDetailModel(
            siteStore: store,
            kitStore: library.kitStore(for: survey),
            routeStore: library.routeStore(for: survey)
        )
        // Every test below hands in its own geocoder; what the app wires in its
        // site — a bundled shape file with Core Location behind it — belongs
        // to FieldmarkUI and is checked there.
        model.load()
        return Fixture(tmp: tmp, library: library, model: model)
    }

    private var norwayStub: StubRegionGeocoder {
        var stub = StubRegionGeocoder()
        stub.results = [Self.zelova: Self.norway, Self.opera: Self.norway]
        return stub
    }

    /// Until the panel stops loading.
    ///
    /// Through the shared ``yieldUntil(_:orAtMostSeconds:)`` rather than a
    /// two-second loop of its own: this target runs its suites in parallel, and
    /// a lookup waiting behind a saturated pool takes longer than two seconds to
    /// get a turn — which failed here as "the panel never resolved".
    private func waitUntilResolved(_ panel: VisitInfoPanelModel) async {
        await yieldUntil { !panel.isLoading }
    }

    // MARK: - Opening

    @Test func showingVisitInfoOpensAPanelThatResolvesTheCountries() async throws {
        let fixture = try makeFixture()
        defer { fixture.tmp.cleanup() }
        fixture.model.visitInfoGeocoder = norwayStub
        #expect(fixture.model.visitInfoPanel == nil)

        fixture.model.showVisitInfo()
        let panel = try #require(fixture.model.visitInfoPanel)
        // Before its task has had a turn: a panel that reads "not loading and
        // nothing found" in that gap is the "No Visit Info" flash, and a driver
        // polling `/state` would stop right there.
        #expect(panel.isLoading)
        await waitUntilResolved(panel)

        #expect(!panel.isLoading)
        #expect(panel.entries.map(\.countryCode) == ["NO"])
        #expect(panel.lastError == nil)
    }

    /// Asking again while it is open keeps the panel on screen as it is.
    @Test func showingItAgainWhileOpenKeepsTheSamePanel() async throws {
        let fixture = try makeFixture()
        defer { fixture.tmp.cleanup() }
        fixture.model.visitInfoGeocoder = norwayStub
        fixture.model.showVisitInfo()
        let panel = try #require(fixture.model.visitInfoPanel)
        await waitUntilResolved(panel)

        fixture.model.showVisitInfo()

        #expect(fixture.model.visitInfoPanel === panel)
        #expect(panel.entries.map(\.countryCode) == ["NO"])
    }

    // MARK: - Closing

    /// A lookup still going when the sheet closes must not write into a panel
    /// nobody can see. The stub ignores cancellation on purpose, so only the
    /// model's own check can stop it.
    @Test func dismissingStopsTheLookupWritingIntoTheClosedPanel() async throws {
        let fixture = try makeFixture()
        defer { fixture.tmp.cleanup() }
        fixture.model.visitInfoGeocoder = SlowRegionGeocoder(delay: 0.3, answer: Self.norway)
        fixture.model.showVisitInfo()
        let panel = try #require(fixture.model.visitInfoPanel)
        try await Task.sleep(for: .milliseconds(50))

        fixture.model.dismissVisitInfo()
        #expect(fixture.model.visitInfoPanel == nil)
        // Longer than both slow lookups put together.
        try await Task.sleep(for: .milliseconds(900))

        #expect(panel.entries.isEmpty)
        #expect(panel.lastError == nil)
        #expect(!panel.isLoading)
    }

    // MARK: - Failing, and trying again

    @Test func aLookupThatFailsSaysSoAndTryAgainRecovers() async throws {
        let fixture = try makeFixture()
        defer { fixture.tmp.cleanup() }
        let geocoder = SwitchableRegionGeocoder(answer: Self.norway)
        fixture.model.visitInfoGeocoder = geocoder
        fixture.model.showVisitInfo()
        let panel = try #require(fixture.model.visitInfoPanel)
        await waitUntilResolved(panel)

        #expect(panel.entries.isEmpty)
        #expect(panel.lastError != nil)

        geocoder.startWorking()
        fixture.model.retryVisitInfo()
        #expect(panel.isLoading)
        await waitUntilResolved(panel)

        #expect(fixture.model.visitInfoPanel === panel)
        #expect(panel.entries.map(\.countryCode) == ["NO"])
        #expect(panel.lastError == nil)
    }
}

// MARK: - Test doubles

/// Answers after a delay it will not cut short, however cancelled its caller.
private struct SlowRegionGeocoder: RegionGeocoder {
    let delay: TimeInterval
    let answer: AdminPlacemark

    func adminPlacemark(for _: Coordinate) async throws -> AdminPlacemark? {
        await withCheckedContinuation { continuation in
            DispatchQueue.global().asyncAfter(deadline: .now() + delay) { continuation.resume() }
        }
        return answer
    }
}

/// Fails every lookup until it is told to start working — a network that is
/// down, and then is not.
private final class SwitchableRegionGeocoder: RegionGeocoder, @unchecked Sendable {
    private let answer: AdminPlacemark
    private let lock = NSLock()
    private var failing = true

    init(answer: AdminPlacemark) {
        self.answer = answer
    }

    func startWorking() {
        lock.withLock { failing = false }
    }

    func adminPlacemark(for _: Coordinate) async throws -> AdminPlacemark? {
        if lock.withLock({ failing }) { throw URLError(.notConnectedToInternet) }
        return answer
    }
}

/// Fails for one coordinate and answers for every other.
private struct FailingForOneRegionGeocoder: RegionGeocoder {
    let failing: Coordinate
    let answer: AdminPlacemark

    func adminPlacemark(for coordinate: Coordinate) async throws -> AdminPlacemark? {
        if coordinate == failing { throw URLError(.timedOut) }
        return answer
    }
}
