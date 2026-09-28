import Foundation
import Observation

/// How long the run has been going.
///
/// The complaint it answers: planning an outing takes two to four minutes — 151,
/// 209 and 237 seconds on the runs this was measured against — and with nothing
/// on screen counting them, a run doing four minutes of work looked exactly like
/// a run that had died. A number that moves is the proof of life, and the number
/// it stops on is the answer to "how long did that take?".
///
/// Its own object rather than four more members on ``OutingRunModel``, because
/// none of this knows anything about surveys, conversations or stores. It
/// starts, it counts, it stops.
@MainActor
@Observable
public final class OutingRunClock {
    /// How long the run has been going, in whole seconds. Counts up about once a
    /// second between ``start()`` and ``stop()``, and then stays where it got
    /// to, so a finished banner can go on saying how long the run took.
    ///
    /// Stored rather than worked out from the start time on demand: a computed
    /// property changes without anything observable changing, so the banner
    /// would draw the first second of a four-minute run and never redraw.
    public private(set) var elapsedSeconds = 0

    // MARK: - Seams

    /// What time it is. The seam ``AnnotationService/annotate(_:now:)`` takes, for
    /// the same reason: a test that had to wait out the minutes it asserts would
    /// take them.
    public var now: @MainActor () -> Date = { Date() }

    /// The wait between two counts. The shape
    /// ``SurveyDetailModel/discoverySleep`` uses, and the other half of what
    /// lets a run of three and a half minutes be tested in as many milliseconds.
    public var tickSleep: (Duration) async throws -> Void = { try await Task.sleep(for: $0) }

    // MARK: - What is running

    /// When the run being counted started, by ``now``. Unobserved: it changes
    /// once a run, and what a banner watches is ``elapsedSeconds``.
    @ObservationIgnored private var startedAt: Date?

    /// The loop doing the counting, kept so it can be stopped — the same
    /// housekeeping ``OutingRunModel/annotationTask`` gets, and for a better
    /// reason: a ticker left behind goes on redrawing a banner about a run that
    /// ended.
    ///
    /// Readable but not settable from outside, so a test can hold a finished run
    /// to leaving nothing running.
    @ObservationIgnored public private(set) var tickTask: Task<Void, Never>?

    public init() {}

    /// How often the count is brought up to date. A second, because a second is
    /// what is being counted: a number that moved less often would read as the
    /// stall this exists to rule out.
    private static let tickInterval = Duration.seconds(1)

    // MARK: - Counting

    /// Start again from nought and count up until ``stop()``.
    ///
    /// Each count is read off ``now`` rather than added to the last one, so a
    /// machine that stalled between two ticks — a lid closed, a box under load —
    /// reports the seconds that went by rather than the ticks that did not.
    public func start() {
        tickTask?.cancel()
        startedAt = now()
        elapsedSeconds = 0
        tickTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                try? await tickSleep(Self.tickInterval)
                guard !Task.isCancelled else { return }
                read()
            }
        }
    }

    /// Stop counting, on the number the run really reached rather than the last
    /// one a tick happened to write. A run that was over before its first tick
    /// still took the time it took.
    public func stop() {
        read()
        tickTask?.cancel()
        tickTask = nil
    }

    private func read() {
        guard let startedAt else { return }
        elapsedSeconds = max(0, Int(now().timeIntervalSince(startedAt)))
    }
}
