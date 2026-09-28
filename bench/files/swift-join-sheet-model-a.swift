import Foundation
import Observation
import FieldmarkCore
import FieldmarkServices

/// The code somebody pasted, the name they will join under, and what happened.
///
/// Shaped like ``FeedbackModel``: one round outing, ``isJoining`` over the whole
/// of it, and the result in exactly one of ``outcome`` and ``lastError``. The
/// typed code is never cleared by a failure — retyping seventy-two characters
/// is the last thing anybody wants to do twice.
@MainActor
@Observable
public final class JoinSheetModel {
    /// What was pasted, verbatim. `InviteCode.parse` trims and lowercases; this
    /// keeps whatever arrived so the box shows it back unchanged.
    public var code = ""
    /// Who to join as. Prefilled from ``AppSettings/spotterName`` when the
    /// sheet opens, and editable.
    public var name = ""
    public private(set) var isJoining = false
    public private(set) var lastError: String?
    /// Which survey to select once this worked, and whether it is a new one.
    public private(set) var outcome: JoinOutcome?

    /// Read fresh when the sheet opens, so a name entered a moment ago is the
    /// one that goes out. The seam ``FeedbackModel/settingsProvider`` already
    /// uses, for the same reason.
    public var settingsProvider: @MainActor () -> AppSettings = { AppSettings.default }

    private let registry: ShareRegistry

    public init(registry: ShareRegistry) {
        self.registry = registry
    }

    /// Join is live once the code parses, and no sooner.
    ///
    /// Whether a well-formed code is *real* is the server's to say — a client
    /// that guessed would refuse codes it has no way to check. This only stops
    /// a request that could not possibly be one.
    public var canJoin: Bool {
        !isJoining && InviteCode.parse(code) != nil
    }

    /// Who this join goes out as: what was typed, or the configured name when
    /// the field has been cleared. Nobody joins nameless — an empty string in
    /// the members list is worse than a name somebody did not choose.
    var joiningName: String {
        let typed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return typed.isEmpty ? settingsProvider().spotterName : typed
    }

    public func join() async {
        guard canJoin else { return }
        isJoining = true
        lastError = nil
        outcome = nil
        defer { isJoining = false }
        do {
            outcome = try await registry.join(code: code, name: joiningName)
        } catch {
            lastError = ShareMessage.message(for: error)
        }
    }

    /// Put the box back to how it looked before anything was pasted. The name
    /// is left alone: it is prefilled from settings, not something a join used
    /// up. A no-op while a join is genuinely in flight, for the reason
    /// ``FeedbackModel/reset()`` is one.
    public func reset() {
        guard !isJoining else { return }
        code = ""
        lastError = nil
        outcome = nil
    }
}
