import Foundation

/// A failed build or test run that says nothing about the sources, and so is
/// tried again rather than blamed on a mutant.
///
/// Blamed on a mutant, a build that failed for lack of memory reads as a mutant
/// that does not compile, which the score leaves out, so a survivor can hide
/// there; and the prune loop drops the container it blames. On 2026-09-24 a
/// proof run started beside another module's run failed its build that way, and
/// 205 containers were dropped over errors no mutant had caused.
public enum RetryableFailure: Equatable, Sendable {
    /// llbuild emits "was modified during the build" when a source file's mtime
    /// changes while a build is in flight. Under the runner's write, build,
    /// restore cycle it fires now and then, and a real compile error never
    /// carries it.
    case buildRace
    /// The machine ran out of memory or processes: `fork` refused, or a
    /// compiler could not start the plugin its macros need.
    case outOfResources

    /// What llbuild prints for its race.
    public static let buildRaceMarker = "was modified during the build"

    /// What the system prints when it has no memory or no process to give.
    public static let outOfResourcesMarkers = ["Cannot allocate memory", "Resource temporarily unavailable"]

    /// `nil` when `output` is an ordinary failure: the sources, or a mutant in
    /// them, which trying again cannot change.
    public init?(output: String) {
        if output.contains(Self.buildRaceMarker) {
            self = .buildRace
        } else if Self.outOfResourcesMarkers.contains(where: output.contains) {
            self = .outOfResources
        } else {
            return nil
        }
    }

    /// How long to wait before `attempt` tries again.
    ///
    /// A race is over at once. Memory comes back when whatever else was
    /// building finishes, which takes longer, so each wait is longer than the
    /// one before: fifteen seconds, then thirty, forty-five and a minute.
    public func delay(beforeAttempt attempt: Int) -> TimeInterval {
        switch self {
        case .buildRace: 0.3
        case .outOfResources: 15 * TimeInterval(max(1, attempt - 1))
        }
    }
}
