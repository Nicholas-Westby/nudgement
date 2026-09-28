import Foundation
import Testing
@testable import FieldmarkCore

// MARK: - What a run leaves behind

/// Annotation used to be silent. A user reporting "it says nothing new was
/// found" left nothing to look at: no line naming the site, no line naming the
/// dead endpoint, nothing saying whether anything had been asked at all — the
/// adapters' own diagnoses (`"invalid api key"`, `"the model returned no message
/// content"`) were built, thrown, and dropped on the floor by a `try?`.
///
/// These pin the stream that replaced that, event by event.
struct AnnotationLoggingTests {
    private static let subject = AnnotationSubject(
        name: "Pellisk",
        coordinate: Coordinate(latitude: 60.3913, longitude: 5.3221),
        locality: "Quelavik",
        country: "Norway"
    )
    private static let articleURL = URL(string: "https://en.wikipedia.org/wiki/Fl%C3%B8yen")!
    private static let thumbnail = URL(string: "https://upload.wikimedia.org/pellisk.jpg")!
    private static let officialSite = URL(string: "https://pellisk.no")!
    private static let answer = #"{"summary": "A mountain.", "website": "https://pellisk.no"}"#

    private static func article(aboutTheSubject: Bool = true) -> ReferenceArticle {
        ReferenceArticle(
            title: "Pellisk",
            extract: "Pellisk is one of the seven mountains.",
            imageURL: thumbnail,
            pageURL: articleURL,
            isAboutTheSubject: aboutTheSubject
        )
    }

    // MARK: Which site, and when it began

    @Test func aRunAnnouncesTheSubjectItIsAbout() async {
        let spy = SpyAnnotationLogger()
        let service = AnnotationService(reference: nil, search: nil, chat: nil, assets: nil, logger: spy)

        _ = await service.annotate(Self.subject)

        #expect(spy.snapshot().first == .started(name: "Pellisk", coordinate: Self.subject.coordinate))
    }

    /// A service handed no logger is the one every existing test builds, and it
    /// must still run — the seam is a diagnostic, not a dependency.
    @Test func aServiceWithNoLoggerStillAnnotates() async {
        let log = AnnotationCallLog()
        let service = AnnotationService(
            reference: StubReferenceLookup(result: Self.article(), log: log), search: nil, chat: nil, assets: nil
        )
        #expect(await service.annotate(Self.subject).summary == "Pellisk is one of the seven mountains.")
    }

    // MARK: The words a refusal came with

    /// The load-bearing assertion of the whole task. `OpenAICompatibleChat`
    /// already builds a redacted, readable reason — `"HTTP 401: invalid api
    /// key"` — and the service used to drop it with a `try?`. Losing that string
    /// is losing the diagnosis: everything downstream can say is `.model`, which
    /// does not distinguish a wrong key from a dead endpoint.
    @Test func aRefusalIsLoggedWithTheUnderlyingErrorsOwnWords() async {
        let spy = SpyAnnotationLogger()
        let log = AnnotationCallLog()
        let service = AnnotationService(
            reference: nil, search: nil,
            chat: StubChatCompleting(error: AnnotationError.underlying("HTTP 401: invalid api key"), log: log),
            assets: nil, logger: spy
        )

        _ = await service.annotate(Self.subject)

        let reason = spy.failureReason(for: .model)
        #expect(reason?.contains("invalid api key") == true)
    }
}
