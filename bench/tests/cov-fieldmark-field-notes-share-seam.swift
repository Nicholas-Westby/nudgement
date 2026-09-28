import Foundation
import Testing
import FieldmarkCore
import FieldmarkPresentation
import FieldmarkServices
@testable import FieldmarkUI

/// Where a shared outing's pull meets the open Field Notes.
///
/// Before a page of changes is applied, whatever the editor has not saved is
/// saved: the page then merges with it on disk, rather than the editor's next
/// save having to fight the page.
@MainActor
@Suite(.serialized)
struct FieldNotesShareSeamTests {
    /// Hands over one typed paragraph, and takes whatever it is sent.
    @MainActor
    private final class TypingEditor: FieldNotesEditing {
        var snapshot = FieldNotesSnapshot(blocks: [
            NoteBlock(content: [.text(NoteText(text: "Typed just before the pull"))]),
        ], notes: [])

        func fieldNotesSnapshot() -> FieldNotesSnapshot {
            snapshot
        }

        func apply(_: FieldNotesPatch) {}
    }

    @Test func mayApplyRemoteFlushesTheNotesFirst() throws {
        let tmp = UITempDir()
        defer { tmp.cleanup() }
        let library = SurveyLibrary(root: tmp.url.appendingPathComponent("Surveys"))
        let survey = try library.create(name: "Norway")
        let detail = try SurveyDetailModel(
            siteStore: library.siteStore(for: survey),
            kitStore: library.kitStore(for: survey),
            routeStore: library.routeStore(for: survey)
        )
        let notesStore = try library.fieldNotesStore(for: survey)
        let notes = FieldNotesModel(store: notesStore, sleep: { _ in try await Task.sleep(for: .seconds(3600)) })
        detail.installFieldNotes(notes)
        let editor = TypingEditor()
        notes.editor = editor
        notes.editorDidChange()
        let engine = try FlockSyncEngine(
            survey: survey, library: library, directory: library.directory(for: survey),
            client: ShareClient(http: NeverArrives(), base: FakeShareServer.base)
        )
        DetailOrError.installShareSeams(detail, list: nil, on: engine)

        #expect(engine.mayApplyRemote())

        #expect(!notes.hasUnsavedChanges)
        #expect(try notesStore.load().visibleBlocks.map(\.plainText) == ["Typed just before the pull"])
    }

    /// A page that changed only the notes: the open notes read the page's
    /// words, and the sites are not read again — which would redraw the map
    /// and ask every photo for its picture again, once per vote while
    /// somebody types on another Mac.
    @Test func aPageOfOnlyNotesReadsTheNotesAndNotTheWholeOuting() throws {
        let tmp = UITempDir()
        defer { tmp.cleanup() }
        let library = SurveyLibrary(root: tmp.url.appendingPathComponent("Surveys"))
        let survey = try library.create(name: "Norway")
        _ = try library.siteStore(for: survey).create(name: "Zelova")
        let detail = try SurveyDetailModel(
            siteStore: library.siteStore(for: survey),
            kitStore: library.kitStore(for: survey),
            routeStore: library.routeStore(for: survey)
        )
        let notesStore = try library.fieldNotesStore(for: survey)
        let notes = FieldNotesModel(store: notesStore, sleep: { _ in try await Task.sleep(for: .seconds(3600)) })
        detail.installFieldNotes(notes)
        detail.load()
        let engine = try FlockSyncEngine(
            survey: survey, library: library, directory: library.directory(for: survey),
            client: ShareClient(http: NeverArrives(), base: FakeShareServer.base)
        )
        DetailOrError.installShareSeams(detail, list: nil, on: engine)
        // What a page writes: another Mac's paragraph, behind the screen's back.
        _ = try notesStore.saveReceived(FieldNotesDocument(blocks: [
            NoteBlock(sort: "V", content: [.text(NoteText(text: "Bring the rain jackets"))]),
        ]))
        let sitesRead = detail.sitesRevision

        let notesOnly = try #require(engine.remoteFieldNotesApplied, "the screen cannot be told about notes alone")
        notesOnly()

        #expect(notes.document.visibleBlocks.map(\.plainText) == ["Bring the rain jackets"])
        #expect(detail.sitesRevision == sitesRead, "the sites were read again for a page of notes")

        DetailOrError.clearShareSeams(on: engine)
        #expect(engine.remoteFieldNotesApplied == nil)
    }
}
