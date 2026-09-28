import Foundation
import Observation
import os
import FieldmarkCore
import FieldmarkServices

/// Performs the join request on behalf of the join sheet.
public protocol JoinPerforming: Sendable {
    func performJoin(code: String, name: String) async throws -> JoinOutcome
}

/// Joins a shared survey through the app's share registry.
public struct RegistryJoinPerformer: JoinPerforming {
    private let registry: ShareRegistry

    public init(registry: ShareRegistry) {
        self.registry = registry
    }

    public func performJoin(code: String, name: String) async throws -> JoinOutcome {
        try await registry.join(code: code, name: name)
    }
}

/// The code somebody pasted, the name they will join under, and what happened.
///
/// Shaped like ``FeedbackModel``: one round outing, ``isJoining`` over the whole
/// of it, and the result in exactly one of ``outcome`` and ``lastError``. The
/// typed code is never cleared by a failure — retyping seventy-two characters
/// is the last thing anybody wants to do twice.
@MainActor
@Observable
public final class JoinSheetModel {
    private static let logger = Logger(subsystem: "app.fieldmark", category: "JoinSheetModel")

    /// What was pasted, verbatim.
    public var code = ""
    /// Who to join as.
    public var name = ""
    public private(set) var isJoining = false
    public private(set) var lastError: String?
    /// Which survey to select once this worked, and whether it is a new one.
    public private(set) var outcome: JoinOutcome?

    /// Read fresh when the sheet opens, so a name entered a moment ago is the
    /// one that goes out.
    public var settingsProvider: @MainActor () -> AppSettings = { AppSettings.default }

    private let performer: any JoinPerforming

    public convenience init(registry: ShareRegistry) {
        self.init(performer: RegistryJoinPerformer(registry: registry))
    }

    public init(performer: any JoinPerforming) {
        self.performer = performer
        Self.logger.debug("JoinSheetModel initialised")
    }

    /// Join is live once the code parses, and no sooner.
    public var canJoin: Bool {
        !isJoining && InviteCode.parse(code) != nil
    }

    /// Who this join goes out as: what was typed, or the configured name when
    /// the field has been cleared.
    var joiningName: String {
        let typed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !typed.isEmpty {
            return typed
        }
        let configured = settingsProvider().spotterName
        if configured.isEmpty {
            Self.logger.warning("Configured spotter name is empty")
            return configured
        }
        return configured
    }

    public func join() async {
        Self.logger.debug("join() called")
        guard canJoin else {
            Self.logger.debug("join() ignored: cannot join")
            return
        }
        guard !code.isEmpty else {
            Self.logger.error("join() called with an empty code")
            return
        }
        guard InviteCode.parse(code) != nil else {
            Self.logger.error("join() called with a code that does not parse")
            return
        }
        isJoining = true
        lastError = nil
        outcome = nil
        defer {
            isJoining = false
            Self.logger.debug("join() finished")
        }
        let joinName = joiningName
        Self.logger.info("Joining as \(joinName, privacy: .private)")
        do {
            let result = try await performer.performJoin(code: code, name: joinName)
            Self.logger.info("Join succeeded")
            outcome = result
        } catch {
            Self.logger.error("Join failed: \(error.localizedDescription, privacy: .public)")
            let message = ShareMessage.message(for: error)
            lastError = message.isEmpty ? "Something went wrong." : message
        }
    }

    /// Put the box back to how it looked before anything was pasted.
    public func reset() {
        guard !isJoining else {
            Self.logger.debug("reset() ignored while joining")
            return
        }
        code = ""
        lastError = nil
        outcome = nil
        Self.logger.debug("reset() done")
    }

    /// Clears the error shown under the code field.
    public func clearError() {
        guard !isJoining else { return }
        lastError = nil
    }

    /// Clears the outcome of the last join.
    public func clearOutcome() {
        guard !isJoining else { return }
        outcome = nil
    }
}
