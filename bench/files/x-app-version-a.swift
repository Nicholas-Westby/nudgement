import Foundation

// MARK: - Version Component

/// Represents an individual component of an ``AppVersion``.
public enum VersionComponent: String, CaseIterable, Sendable {
    /// The major version component.
    case major
    /// The minor version component.
    case minor
    /// The patch version component.
    case patch
}

// MARK: - Errors

/// Errors that can occur while parsing an ``AppVersion``.
public enum AppVersionError: Error, LocalizedError, Equatable {
    /// The input string was empty.
    case emptyInput
    /// The input string had an unexpected number of components.
    case invalidComponentCount(Int)
    /// A component was empty.
    case emptyComponent
    /// A component could not be parsed as a number.
    case nonNumericComponent(String)
    /// A component was negative.
    case negativeComponent(Int)

    /// A human-readable description of the error.
    public var errorDescription: String? {
        switch self {
        case .emptyInput:
            return "The version string is empty."
        case let .invalidComponentCount(count):
            return "Expected 2 or 3 version components but found \(count)."
        case .emptyComponent:
            return "The version string contains an empty component."
        case let .nonNumericComponent(component):
            return "The version component '\(component)' is not a number."
        case let .negativeComponent(value):
            return "The version component \(value) is negative."
        }
    }
}

// MARK: - Parsing

/// A type that can parse version strings into ``AppVersion`` values.
public protocol AppVersionParsing: Sendable {
    /// Parses the given string into an ``AppVersion``.
    ///
    /// - Parameter text: The string to parse.
    /// - Returns: The parsed version.
    /// - Throws: ``AppVersionError`` if the string is not a valid version.
    func parse(_ text: String) throws -> AppVersion
}

/// The default implementation of ``AppVersionParsing``.
///
/// Reads `1.4.2`, or `1.4` for `1.4.0`. Anything that is not two or three runs
/// of digits is refused rather than guessed at.
public struct DefaultAppVersionParser: AppVersionParsing {
    /// The separator between version components.
    public let separator: Character
    /// The minimum number of components allowed.
    public let minimumComponents: Int
    /// The maximum number of components allowed.
    public let maximumComponents: Int

    /// Creates a new parser.
    ///
    /// - Parameters:
    ///   - separator: The separator between version components. Defaults to `.`.
    ///   - minimumComponents: The minimum number of components. Defaults to `2`.
    ///   - maximumComponents: The maximum number of components. Defaults to `3`.
    public init(separator: Character = ".", minimumComponents: Int = 2, maximumComponents: Int = 3) {
        self.separator = separator
        self.minimumComponents = minimumComponents
        self.maximumComponents = maximumComponents
    }

    /// Parses the given string into an ``AppVersion``.
    ///
    /// - Parameter text: The string to parse.
    /// - Returns: The parsed version.
    /// - Throws: ``AppVersionError`` if the string is not a valid version.
    public func parse(_ text: String) throws -> AppVersion {
        // Trim surrounding whitespace
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)

        // Make sure the string is not empty
        guard !trimmed.isEmpty else {
            throw AppVersionError.emptyInput
        }

        // Split the string into its components
        let parts = trimmed.split(separator: separator, omittingEmptySubsequences: false)

        // Validate the number of components
        guard parts.count >= minimumComponents, parts.count <= maximumComponents else {
            throw AppVersionError.invalidComponentCount(parts.count)
        }

        // Parse each component
        var numbers: [Int] = []
        for part in parts {
            numbers.append(try parseComponent(part))
        }

        // Build the version, defaulting missing components to zero
        let major = numbers.count > 0 ? numbers[0] : 0
        let minor = numbers.count > 1 ? numbers[1] : 0
        let patch = numbers.count > 2 ? numbers[2] : 0

        return AppVersion(major: major, minor: minor, patch: patch)
    }

    /// Parses a single version component.
    ///
    /// - Parameter part: The component to parse.
    /// - Returns: The numeric value of the component.
    /// - Throws: ``AppVersionError`` if the component is not a valid number.
    private func parseComponent(_ part: Substring) throws -> Int {
        let component = String(part)

        guard !component.isEmpty else {
            throw AppVersionError.emptyComponent
        }

        guard component.allSatisfy({ $0.isASCII && $0.isNumber }) else {
            throw AppVersionError.nonNumericComponent(component)
        }

        guard let number = Int(component) else {
            throw AppVersionError.nonNumericComponent(component)
        }

        guard number >= 0 else {
            throw AppVersionError.negativeComponent(number)
        }

        return number
    }
}

// MARK: - AppVersion

/// The version of a build, as `major.minor.patch`.
///
/// An installed copy compares its own against the one the update feed
/// advertises, so the two have to be read the same way on both sides of the
/// wire.
public struct AppVersion: Equatable, Comparable, Hashable, Sendable, CustomStringConvertible {
    /// The major version number.
    public let major: Int
    /// The minor version number.
    public let minor: Int
    /// The patch version number.
    public let patch: Int

    /// The parser used to read version strings.
    private static let parser: any AppVersionParsing = DefaultAppVersionParser()

    /// Creates a new version from its components.
    ///
    /// - Parameters:
    ///   - major: The major version number.
    ///   - minor: The minor version number.
    ///   - patch: The patch version number.
    public init(major: Int, minor: Int, patch: Int) {
        self.major = major
        self.minor = minor
        self.patch = patch
    }

    /// Creates a new version by parsing a string such as `1.4.2` or `1.4`.
    ///
    /// - Parameter text: The version string to parse.
    /// - Returns: `nil` if the string is not a valid version.
    public init?(_ text: String) {
        do {
            self = try Self.parser.parse(text)
        } catch {
            return nil
        }
    }

    /// Returns the value of the given component.
    ///
    /// - Parameter component: The component to read.
    /// - Returns: The value of the component.
    public func value(of component: VersionComponent) -> Int {
        switch component {
        case .major:
            return major
        case .minor:
            return minor
        case .patch:
            return patch
        }
    }

    /// A textual representation of the version, such as `1.4.2`.
    public var description: String {
        let components = VersionComponent.allCases.map { String(value(of: $0)) }
        return components.joined(separator: ".")
    }

    // MARK: - Comparable

    /// Returns a Boolean value indicating whether the first version is older
    /// than the second.
    ///
    /// - Parameters:
    ///   - lhs: The first version to compare.
    ///   - rhs: The second version to compare.
    /// - Returns: `true` if `lhs` is older than `rhs`.
    public static func < (lhs: AppVersion, rhs: AppVersion) -> Bool {
        if lhs.major != rhs.major {
            return lhs.major < rhs.major
        } else if lhs.minor != rhs.minor {
            return lhs.minor < rhs.minor
        } else if lhs.patch != rhs.patch {
            return lhs.patch < rhs.patch
        } else {
            return false
        }
    }

    // MARK: - Bumping

    /// Returns a new version with the given component incremented.
    ///
    /// Lower components are reset to zero, following semantic versioning.
    ///
    /// - Parameter component: The component to increment.
    /// - Returns: The bumped version.
    public func bumping(_ component: VersionComponent) -> AppVersion {
        switch component {
        case .major:
            return AppVersion(major: major + 1, minor: 0, patch: 0)
        case .minor:
            return AppVersion(major: major, minor: minor + 1, patch: 0)
        case .patch:
            return AppVersion(major: major, minor: minor, patch: patch + 1)
        }
    }

    /// The next patch release. What the pre-commit hook writes back.
    ///
    /// - Returns: The version with its patch component incremented.
    public func bumpingPatch() -> AppVersion {
        return bumping(.patch)
    }
}
