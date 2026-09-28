import Foundation

/// Why an update stopped, each with the sentence the sheet shows.
///
/// Every one of these is raised before anything is moved, except
/// ``swapFailed``, which is raised after the old copy has been put back.
public enum UpdateInstallError: Error, Equatable {
    /// The app is running from the read-only copy macOS makes when a bundle is
    /// opened straight from the download, without ever being moved.
    case translocated
    /// The folder the app lives in, which this account cannot write to.
    case notWritable(String)
    case checksumMismatch
    case couldNotUnpack(String)
    /// The zip held no app, or more than one.
    case nothingToInstall
    /// The identifier the download's plist claims.
    case wrongApp(String)
    /// The version the download's plist claims.
    case wrongVersion(String)
    /// The macOS the download needs.
    case needsNewerMacOS(String)
    /// What the Security framework said.
    case notSigned(String)
    /// What went wrong moving it into site. The previous copy is back.
    case swapFailed(String)
    /// The move in failed and so did the move back, so the previous copy is
    /// still in the staging folder, at this path. The folder is kept when this
    /// is thrown: it holds the only Fieldmark left on the machine.
    case previousCopyStranded(String)

    public var message: String {
        switch self {
        case .translocated:
            "Fieldmark is running from a temporary site because it was opened straight from the download. "
                + "Move it into the Applications folder, open it from there, and update again."
        case let .notWritable(folder):
            "Fieldmark cannot replace itself in \(folder) because this account cannot write there. "
                + "Download the new version and drag it into Applications."
        case .checksumMismatch:
            "The download did not match what the site published, so it was not installed."
        case let .couldNotUnpack(reason):
            "The download could not be unpacked: \(reason)."
        case .nothingToInstall:
            "The download did not contain Fieldmark, so nothing was installed."
        case let .wrongApp(identifier):
            "The download is a different app (\(identifier)), so it was not installed."
        case let .wrongVersion(version):
            "The download says it is version \(version), not the one that was offered, "
                + "so it was not installed."
        case let .needsNewerMacOS(version):
            "The new version needs macOS \(version) or later, which this Mac does not have."
        case .notSigned:
            "The download is not signed by Fieldmark's developer, so it was not installed."
        case let .swapFailed(reason):
            "The new version could not be moved into site (\(reason)). "
                + "The previous version is still installed."
        case let .previousCopyStranded(path):
            "The update could not be finished, and the previous version of Fieldmark could not be put back. "
                + "It has not been lost: it is at \(path). Move it into your Applications folder to "
                + "carry on using it."
        }
    }
}

/// How far along the install is. Reported so the sheet can say "Checking the
/// download…" and then "Installing…" while the work happens off the main actor.
public enum UpdateInstallStage: Equatable, Sendable {
    case checking
    case installing
}
