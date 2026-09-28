import AppKit
import os
import FieldmarkCore

/// ⌘F in Field Notes: the standard find bar, searching the document and every
/// highlight note on it.
///
/// The text it searches is the document with each note's words right after
/// the paragraph its words are in (``FieldNotesFindMap``). A match in a note is
/// shown by opening the note's popover — the chain of them, for a note on a
/// note — with the match selected there, while the find bar keeps the
/// keyboard; a match back in the document closes what the search opened.
///
/// The finder reads the text on a background thread while it searches (seen
/// in the spike of 2026-09-27), so what it reads is a snapshot that never
/// changes once made, swapped under a lock. The snapshot is made again, on
/// the main thread, the first time the finder asks after a change.
@MainActor
final class FieldNotesFinder: NSObject {
    let textFinder: NSTextFinder
    private let controller: FieldNotesEditorController
    private let presenter: HighlightNotesPresenter
    private let snapshot = OSAllocatedUnfairLock(initialState: FieldNotesFindText.empty)
    private var isStale = true
    /// The note holding the match shown last: where Find Next goes on from.
    private var shownNote: UUID?
    /// The first popover the search opened, which closing closes the rest.
    private weak var openedBySearch: HighlightNotesPopover?

    init(
        controller: FieldNotesEditorController,
        presenter: HighlightNotesPresenter,
        container: NSTextFinderBarContainer?,
        textFinder: NSTextFinder = NSTextFinder()
    ) {
        self.controller = controller
        self.presenter = presenter
        self.textFinder = textFinder
        super.init()
        textFinder.client = self
        textFinder.findBarContainer = container
        textFinder.isIncrementalSearchingEnabled = true
        controller.textView.textFinder = textFinder
        controller.onFindTextWillChange = { [weak self] in self?.textWillChange() }
    }

    /// The editor is going: the finder lets go of it, and its bar goes too.
    func detach() {
        if textFinder.findBarContainer?.isFindBarVisible == true {
            textFinder.performAction(.hideFindInterface)
        }
        textFinder.client = nil
        textFinder.findBarContainer = nil
        controller.onFindTextWillChange = nil
    }

    /// Something is about to change what is searched: the document's words,
    /// a note's, or which notes there are.
    func textWillChange() {
        isStale = true
        textFinder.noteClientStringWillChange()
    }

    /// What is searched now, made again if it changed.
    private var current: FieldNotesFindText {
        if isStale, let storage = controller.textView.textStorage {
            isStale = false
            var open: [UUID: NSAttributedString] = [:]
            for popover in presenter.open {
                for body in popover.bodies {
                    open[body.noteID] = body.textView.textStorage
                }
            }
            let made = FieldNotesFindText.make(document: storage, notes: controller.noteStore.all, open: open)
            snapshot.withLock { $0 = made }
            return made
        }
        return snapshot.withLock { $0 }
    }

    /// Shows `range` of `source`'s words: in the document, closing the notes
    /// the search opened; in a note, opening it without taking the keyboard.
    /// `select` is for Escape and ⌘G, which leave the match selected — with
    /// the find bar gone, the keyboard goes to it too.
    private func show(_ range: NSRange, of source: FieldNotesFindMap.Source, select: Bool) {
        switch source {
        case .document:
            closeWhatSearchOpened()
            if select { controller.textView.setSelectedRange(range) }
            controller.textView.scrollRangeToVisible(range)
        case let .note(id):
            guard let body = openNote(id) else { return }
            shownNote = id
            body.textView.setSelectedRange(range)
            body.textView.scrollRangeToVisible(range)
            if select {
                // Escape selects the match while the bar is still up, and the
                // finder then gives the document the keyboard back: after
                // that, with the bar gone, the note takes it. ⌘G with the bar
                // up leaves the keyboard in the bar.
                DispatchQueue.main.async { [weak self, weak body] in
                    guard let self, let body, let window = body.textView.window,
                          textFinder.findBarContainer?.isFindBarVisible != true
                    else { return }
                    window.makeKey()
                    window.makeFirstResponder(body.textView)
                }
            }
        }
    }

    private func closeWhatSearchOpened() {
        shownNote = nil
        if let popover = openedBySearch {
            openedBySearch = nil
            presenter.closed(popover)
        }
    }

    /// The editor of note `id`'s words, opened if it is not: the popover on
    /// the document's words it is on, and for a note on a note, the popovers
    /// beside it down to `id`.
    private func openNote(_ id: UUID) -> NoteBodyController? {
        if let body = openBody(id) { return body }
        var chain = [id]
        while let parent = controller.noteStore.note(chain[0])?.parent, !chain.contains(parent) {
            chain.insert(parent, at: 0)
        }
        let keyboard = KeyboardHolder(window: controller.textView.window)
        var source: FieldNotesTextView = controller.textView
        var first: HighlightNotesPopover?
        defer {
            if let first { openedBySearch = first }
            keyboard.giveBack()
        }
        for note in chain {
            if let open = openBody(note) {
                source = open.textView
                continue
            }
            guard let words = Self.words(of: note, in: source) else { return nil }
            source.scrollRangeToVisible(words)
            let ids = FieldNotesConverter.noteIDs(source.textStorage?.attribute(.tnNotes, at: words.location,
                                                                               effectiveRange: nil))
            presenter.open(ids: ids, at: source.rect(of: words), in: source, takesKeyboard: false)
            guard let popover = presenter.open.last, let body = popover.bodyEditor(for: note) else { return nil }
            if first == nil { first = popover }
            source = body.textView
        }
        return openBody(id)
    }

    private func openBody(_ id: UUID) -> NoteBodyController? {
        for popover in presenter.open {
            if let body = popover.bodyEditor(for: id) { return body }
        }
        return nil
    }

    /// The first stretch of `source` carrying note `id`.
    private static func words(of id: UUID, in source: FieldNotesTextView) -> NSRange? {
        guard let storage = source.textStorage else { return nil }
        var found: NSRange?
        storage.enumerateAttribute(.tnNotes, in: storage.wholeRange) { value, run, stop in
            if FieldNotesConverter.noteIDs(value).contains(id) {
                found = run
                stop.pointee = true
            }
        }
        return found
    }

    /// A note's words with the keyboard, when one has it.
    private func focusedBody() -> NoteBodyController? {
        for popover in presenter.open {
            for body in popover.bodies where body.textView.window?.isKeyWindow == true
                && body.textView.window?.firstResponder === body.textView {
                return body
            }
        }
        return nil
    }

    private func view(showing source: FieldNotesFindMap.Source) -> FieldNotesTextView? {
        switch source {
        case .document: controller.textView
        case let .note(id): openBody(id)?.textView
        }
    }

    /// Where `range` is drawn in `view`, in the view's coordinates.
    private static func rects(of range: NSRange, in view: FieldNotesTextView) -> [NSRect] {
        guard let layout = view.layoutManager, let container = view.textContainer else { return [] }
        let glyphs = layout.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
        var rects: [NSRect] = []
        layout.enumerateEnclosingRects(
            forGlyphRange: glyphs, withinSelectedGlyphRange: NSRange(location: NSNotFound, length: 0),
            in: container
        ) { rect, _ in
            rects.append(rect.offsetBy(dx: view.textContainerOrigin.x, dy: view.textContainerOrigin.y))
        }
        return rects
    }

    private static func visibleCharacters(of view: FieldNotesTextView) -> NSRange? {
        guard let layout = view.layoutManager, let container = view.textContainer else { return nil }
        let visible = view.visibleRect.offsetBy(dx: -view.textContainerOrigin.x, dy: -view.textContainerOrigin.y)
        let glyphs = layout.glyphRange(forBoundingRect: visible, in: container)
        return layout.characterRange(forGlyphRange: glyphs, actualGlyphRange: nil)
    }
}

extension FieldNotesFinder: @preconcurrency NSTextFinderClient {
    nonisolated func stringLength() -> Int {
        if Thread.isMainThread {
            return MainActor.assumeIsolated { current.map.length }
        }
        return snapshot.withLock { $0.map.length }
    }

    /// Called on a background thread while the finder searches, with an
    /// index from the snapshot it last measured: after a change, that index
    /// can be past the end of the new one, which answers nothing rather than
    /// crash.
    nonisolated func string(
        at characterIndex: Int,
        effectiveRange outRange: NSRangePointer,
        endsWithSearchBoundary outFlag: UnsafeMutablePointer<ObjCBool>
    ) -> String {
        let text = snapshot.withLock { $0 }
        outFlag.pointee = true
        guard let piece = text.map.piece(containing: characterIndex), let characters = text.texts[piece.start] else {
            outRange.pointee = NSRange(location: text.map.length, length: 0)
            return ""
        }
        outRange.pointee = NSRange(location: piece.start, length: piece.range.length)
        return characters
    }

    /// Where Find Next goes on from: the words a note's editor has selected
    /// while it has the keyboard, else the match last shown in a note, else
    /// the document's selection.
    var firstSelectedRange: NSRange {
        let map = current.map
        if let body = focusedBody() ?? shownNote.flatMap(openBody),
           let range = map.searchedRange(of: body.textView.selectedRange(), in: .note(body.noteID)) {
            return range
        }
        return map.searchedRange(of: controller.textView.selectedRange(), in: .document)
            ?? NSRange(location: 0, length: 0)
    }

    var selectedRanges: [NSValue] {
        get { [NSValue(range: firstSelectedRange)] }
        set {
            guard let range = newValue.first?.rangeValue, let found = current.map.sourceRange(of: range) else { return }
            show(found.range, of: found.source, select: true)
        }
    }

    /// How the finder shows each match while the find bar is up.
    func scrollRangeToVisible(_ range: NSRange) {
        guard let found = current.map.sourceRange(of: range) else { return }
        show(found.range, of: found.source, select: false)
    }

    func contentView(at index: Int, effectiveCharacterRange outRange: NSRangePointer) -> NSView {
        let map = current.map
        guard let piece = map.piece(containing: index) else {
            outRange.pointee = NSRange(location: 0, length: map.length)
            return controller.textView
        }
        outRange.pointee = NSRange(location: piece.start, length: piece.range.length)
        // A note that is not open has nowhere to show its match: the
        // document stands in, with nothing drawn (see `rects`).
        return view(showing: piece.source) ?? controller.textView
    }

    func rects(forCharacterRange range: NSRange) -> [NSValue]? {
        guard let found = current.map.sourceRange(of: range), let view = view(showing: found.source) else {
            return []
        }
        return Self.rects(of: found.range, in: view).map { NSValue(rect: $0) }
    }

    var visibleCharacterRanges: [NSValue] {
        let map = current.map
        var ranges: [NSRange] = []
        if let visible = Self.visibleCharacters(of: controller.textView),
           let range = map.searchedRange(of: visible, in: .document) {
            ranges.append(range)
        }
        for popover in presenter.open {
            for body in popover.bodies {
                let words = NSRange(location: 0, length: body.textView.string16Length)
                if let range = map.searchedRange(of: words, in: .note(body.noteID)) { ranges.append(range) }
            }
        }
        return ranges.map { NSValue(range: $0) }
    }

    /// The words on the yellow find indicator, dark so they read on it. Left
    /// to the text view's own drawing, the indicator over the document was a
    /// blank yellow box.
    func drawCharacters(in range: NSRange, forContentView view: NSView) {
        guard let text = view as? FieldNotesTextView, let layout = text.fieldNotesLayout,
              let found = current.map.sourceRange(of: range)
        else { return }
        let glyphs = layout.glyphRange(forCharacterRange: found.range, actualCharacterRange: nil)
        layout.drawsFindIndicator = true
        layout.drawGlyphs(forGlyphRange: glyphs, at: text.textContainerOrigin)
        layout.drawsFindIndicator = false
    }

    /// Replace changes the document's own words only: a match in a note is
    /// not replaced. Replace All asks once for all its matches, then
    /// replaces them one at a time, and `replaceCharacters` skips a note's.
    func shouldReplaceCharacters(inRanges ranges: [NSValue], with _: [String]) -> Bool {
        guard controller.textView.isEditable else { return false }
        let map = current.map
        return ranges.contains { map.sourceRange(of: $0.rangeValue)?.source == .document }
    }

    func replaceCharacters(in range: NSRange, with string: String) {
        guard let found = current.map.sourceRange(of: range), found.source == .document else { return }
        let view = controller.textView
        guard view.shouldChangeText(in: found.range, replacementString: string) else { return }
        view.replaceCharacters(in: found.range, with: string)
        view.didChangeText()
    }
}

/// Whatever has the keyboard in a window, to give it back after a popover is
/// shown there. Showing one hands the first thing in it that takes the
/// keyboard — a note's words, or its Reply button — the keyboard of the
/// window it points into, as AppKit does for a sheet
/// (`_makeParentWindowHaveFirstResponder:`, seen live), so Return or the
/// next letters typed in the find bar landed in the note, over the match.
@MainActor
private struct KeyboardHolder {
    let window: NSWindow?
    let holder: NSResponder?
    /// A text field being typed in is held by its field editor: the field,
    /// and where its caret was.
    let field: NSTextField?
    let selection: NSRange?

    init(window: NSWindow?) {
        self.window = window
        holder = window?.firstResponder
        let editor = holder as? NSTextView
        field = editor?.isFieldEditor == true ? editor?.delegate as? NSTextField : nil
        selection = editor?.selectedRange()
    }

    func giveBack() {
        guard let window, let holder, window.firstResponder !== holder else { return }
        if let field, let selection {
            window.makeFirstResponder(field)
            (field.currentEditor() as? NSTextView)?.setSelectedRange(selection)
        } else {
            window.makeFirstResponder(holder)
        }
    }
}
