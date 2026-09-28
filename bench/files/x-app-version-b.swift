import Foundation

/// The version of a build, as `major.minor.patch`.
///
/// An installed copy compares its own against the one the update feed
/// advertises, so the two have to be read the same way on both sides of the
/// wire. Kept as three numbers rather than a string because the ordering is the
/// whole point: `1.10.0` is newer than `1.9.0`, and no text comparison agrees.
///
/// It is read from the `VERSION` file rather than counted from git history,
/// because the download carries no `.git` folder to count.
public struct AppVersion: Equatable, Comparable, Hashable, Sendable, CustomStringConvertible {
    public let major: Int
    public let minor: Int
    public let patch: Int

    public init(major: Int, minor: Int, patch: Int) {
        self.major = major
        self.minor = minor
        self.patch = patch
    }

    /// Reads `1.4.2`, or `1.4` for `1.4.0`, and nothing else.
    ///
    /// Anything that is not two or three runs of digits is refused rather than
    /// guessed at: a version that parses wrongly compares wrongly, and an app
    /// that thinks it is newer than the server never updates again.
    public init?(_ text: String) {
        let parts = text.trimmingCharacters(in: .whitespacesAndNewlines).split(
            separator: ".",
            omittingEmptySubsequences: false
        )
        guard (2 ... 3).contains(parts.count) else { return nil }

        var numbers: [Int] = []
        for part in parts {
            guard !part.isEmpty, part.allSatisfy(\.isASCIIDigit), let number = Int(part) else { return nil }
            numbers.append(number)
        }

        self.init(major: numbers[0], minor: numbers[1], patch: numbers.count > 2 ? numbers[2] : 0)
    }

    public var description: String {
        "\(major).\(minor).\(patch)"
    }

    public static func < (lhs: AppVersion, rhs: AppVersion) -> Bool {
        (lhs.major, lhs.minor, lhs.patch) < (rhs.major, rhs.minor, rhs.patch)
    }

    /// The next patch release. What the pre-commit hook writes back.
    public func bumpingPatch() -> AppVersion {
        AppVersion(major: major, minor: minor, patch: patch + 1)
    }
}

private extension Character {
    var isASCIIDigit: Bool {
        isASCII && isNumber
    }
}
