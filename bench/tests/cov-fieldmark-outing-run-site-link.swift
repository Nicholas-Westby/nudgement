import Foundation
import Testing
import FieldmarkCore
@testable import FieldmarkPresentation
@testable import FieldmarkServices

/// What the `add_site` sink files the model's link under.
///
/// The pin it writes is annotated moments later, and that pass adds the official
/// site it finds as a link of its own. While both writers spelled their link
/// "Website" an import could leave a site with two rows under one word. The
/// real one read `heronlodge.no/accomodation/` and `heronlodge.no/`, so the title
/// is decided against the links the site already has instead.
@MainActor
@Suite(.serialized)
struct OutingRunSiteLinkTests {
    private func makeModel(_ script: [AgentMessage], library: SurveyLibrary) -> OutingRunModel {
        let model = OutingRunModel(library: library)
        model.settingsProvider = {
            var settings = AppSettings.default
            settings.llmAPIKey = "test-key"
            return settings
        }
        model.agentProvider = { _ in ScriptedAgentChat(script) }
        let ledger = ledgerHoldingWhateverIsAddedIn(script)
        model.toolFactory = { settings, sink in
            // Stubs, not the live MapKit and CoreLocation adapters: these scripts
            // call add_site with no geocode or search_map before it, so the two
            // were never asked anything — and a stub keeps the file out of the
            // slow test target.
            OutingToolFactory.tools(
                for: settings, sink: sink,
                searcher: FakeSiteSearcher(results: []), geocoder: StubGeocoder(),
                ledger: ledger
            )
        }
        // Offline: nothing annotates, so the only link is the one add_site wrote.
        model.annotationServiceProvider = { _ in
            AnnotationService(reference: nil, search: nil, chat: nil, assets: nil)
        }
        return model
    }

    private func script(linking address: String) -> [AgentMessage] {
        let call = AgentToolCall(id: "a", name: "add_site", arguments: """
        {"name":"HeronLodge Delta","latitude":60.3975,"longitude":5.3242,"summary":"A glass cabin.",\
        "category":"lodging","link":"\(address)"}
        """)
        return [
            .assistant(content: "", toolCalls: [call]),
            .assistant(content: "One stop.", toolCalls: []),
        ]
    }

    private func titleOfTheOnlyLink(in library: SurveyLibrary, _ survey: Survey) throws -> String {
        let sites = try library.siteStore(for: survey).list()
        let site = try #require(sites.first)
        #expect(site.links.count == 1)
        return try #require(site.links.first).title
    }

    /// A reader knows what a Booking.com page is before they open it, and a
    /// second link to the site's own site can then say so too.
    @Test func namesThePageItWasShownAfterTheSiteItIsOn() async throws {
        let tmp = TempDir(); defer { tmp.cleanup() }
        let library = SurveyLibrary(root: tmp.url)
        let address = "https://www.booking.com/reserve/no/heronlodge-delta.html"
        let model = makeModel(script(linking: address), library: library)

        let survey = try #require(await model.plan(PlanBrief(region: "Norway")))

        #expect(try titleOfTheOnlyLink(in: library, survey) == "Booking.com")
    }

    /// A reserve's own domain is not a name anyone recognises, so the generic word
    /// is still the right answer for it, once.
    @Test func callsAPlacesOwnSiteWebsite() async throws {
        let tmp = TempDir(); defer { tmp.cleanup() }
        let library = SurveyLibrary(root: tmp.url)
        let model = makeModel(script(linking: "https://heronlodge.no/accomodation/"), library: library)

        let survey = try #require(await model.plan(PlanBrief(region: "Norway")))

        #expect(try titleOfTheOnlyLink(in: library, survey) == "Website")
    }
}
