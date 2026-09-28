import Foundation
import Testing
import FieldmarkCore
@testable import FieldmarkPresentation

/// Pressing a link button on the saved-site card.
///
/// The link opens in the same in-app browser the discovered card's "Website"
/// button uses, rather than handing the page to Safari: the browser is where a
/// page's picture can be picked as the site's photo, and a link the user
/// followed to look at a site is exactly when they would want to.
@MainActor
@Suite(.serialized)
struct SiteCardLinkOpeningTests {
    /// Discovery reads a filter persisted in `UserDefaults`, which outlives a
    /// test. Held here so this suite starts from the default and leaves it that
    /// way — see ``DiscoverySelectionDefaults``.
    private let discoveryDefaults = DiscoverySelectionDefaults()
    private func makeModel(in tmp: TempDir, discovering: [DiscoveredSite] = []) throws -> SurveyDetailModel {
        let library = SurveyLibrary(root: tmp.url)
        let survey = try library.create(name: "Link-Test")
        let model = try SurveyDetailModel(
            siteStore: library.siteStore(for: survey),
            kitStore: library.kitStore(for: survey),
            routeStore: library.routeStore(for: survey)
        )
        model.discoverySleep = { _ in }
        model.annotationServiceProvider = { _ in
            AnnotationService(reference: nil, search: nil, chat: nil, assets: nil)
        }
        model.imageDataLoader = { _ in nil }
        model.siteDiscoverer = FakeSiteDiscoverer(results: discovering)
        model.load()
        return model
    }

    private var region: CoordinateRegion {
        CoordinateRegion(
            center: Coordinate(latitude: 63.45, longitude: 10.5),
            latitudeDelta: 0.5,
            longitudeDelta: 0.5
        )
    }

    @Test func openingALinkOpensTheInAppBrowserOnIt() throws {
        let tmp = TempDir()
        defer { tmp.cleanup() }
        let model = try makeModel(in: tmp)
        let site = try #require(model.addSite(name: "Birch Moor"))
        let link = try Link(title: "Official site", url: #require(URL(string: "https://birchmoor.no")))

        model.openLink(link, for: site)

        let target = try #require(model.webSearchTarget)
        #expect(target.url.absoluteString == "https://birchmoor.no")
        #expect(target.subject == .site(site.id))
    }

    /// The browser's title bar names the site, not the link: the user knows
    /// which page they asked for, and by page three they may not.
    @Test func theBrowserIsTitledWithTheSite() throws {
        let tmp = TempDir()
        defer { tmp.cleanup() }
        let model = try makeModel(in: tmp)
        let site = try #require(model.addSite(name: "Birch Moor"))
        let link = try Link(title: "Menu", url: #require(URL(string: "https://birchmoor.no/diner")))

        model.openLink(link, for: site)

        #expect(try #require(model.webSearchTarget).title == "Birch Moor")
    }

    /// The two ways into the browser have to stay distinguishable, because what
    /// a picked image gets attached to depends on which one opened it.
    @Test func aDiscoverysBrowserSaysItIsADiscoverys() async throws {
        let discovery = DiscoveredSite(
            name: "Birch Moor",
            coordinate: Coordinate(latitude: 63.45, longitude: 10.5),
            category: "museum",
            address: "Wennumb, Harnark"
        )
        let tmp = TempDir()
        defer { tmp.cleanup() }
        let model = try makeModel(in: tmp, discovering: [discovery])
        await model.discover(in: region)
        model.selectedDiscoveredID = try #require(model.discoveredSites.first).discoveryID

        model.openWebSearchForSelectedDiscovery()

        let target = try #require(model.webSearchTarget)
        #expect(target.subject == .discovery(model.discoveredSites[0].discoveryID))
    }
}
