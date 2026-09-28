import Foundation

/// Where an update is, from the moment somebody says yes to the moment the
/// app quits to be replaced.
public enum UpdatePhase: Equatable, Sendable {
    case idle
    case downloading(received: Int64, total: Int64?)
    /// The checksum and the signature.
    case checking
    /// The swap.
    case installing
    case relaunching
    /// Why it stopped, and where the download is for somebody to install by
    /// hand — when there is one. There is nothing to download once the swap has
    /// already happened: the new version is on disk, and pointing at the zip
    /// again would send somebody to fix a problem they do not have.
    case failed(message: String, download: URL?)

    /// The word `/state` reports.
    public var name: String {
        switch self {
        case .idle: "idle"
        case .downloading: "downloading"
        case .checking: "checking"
        case .installing: "installing"
        case .relaunching: "relaunching"
        case .failed: "failed"
        }
    }

    /// Whether the progress sheet belongs on screen.
    ///
    /// Everything but `idle` and `relaunching`. `relaunching` is the exception
    /// and the reason this is not simply `self != .idle`: AppKit treats a
    /// presented sheet that cannot be dismissed as a modal the user has to
    /// finish, and answers `NSApp.terminate` with cancel while one is up. The
    /// app quits in exactly that phase, so the sheet has to be gone first — a
    /// live rehearsal found the swap done, the relaunch shell waiting, and the
    /// old copy stuck on "Relaunching…" for want of this.
    public var showsSheet: Bool {
        switch self {
        case .idle, .relaunching: false
        case .downloading, .checking, .installing, .failed: true
        }
    }

    /// A fraction of the download, while there is one and its size is known.
    public var progress: Double? {
        guard case let .downloading(received, total) = self, let total, total > 0 else { return nil }
        return Double(received) / Double(total)
    }

    public var isDownloading: Bool {
        if case .downloading = self { return true }
        return false
    }

    public var isFailed: Bool {
        if case .failed = self { return true }
        return false
    }
}

/// The words on the progress sheet.
public enum UpdateProgressText {
    public static func title(for version: AppVersion) -> String {
        "Updating Fieldmark to \(version)"
    }

    public static func status(for phase: UpdatePhase) -> String {
        switch phase {
        case .idle: ""
        case let .downloading(received, total):
            if let total, total > 0 {
                "Downloading… \(bytes(received)) of \(bytes(total))"
            } else {
                "Downloading…"
            }
        case .checking: "Checking the download…"
        case .installing: "Installing…"
        case .relaunching: "Relaunching…"
        case let .failed(message, _): message
        }
    }

    /// Spelled out rather than handed to `ByteCountFormatter`, which writes
    /// "4,2 MB" under half the locales in Europe and would make the line
    /// disagree with itself from one Mac to the next. `String(format:)` with no
    /// locale is the POSIX one, so the point is always a point.
    private static func bytes(_ count: Int64) -> String {
        count >= 1_000_000
            ? String(format: "%.1f MB", Double(count) / 1_000_000)
            : "\(count / 1000) KB"
    }
}
