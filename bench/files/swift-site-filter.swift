import Foundation

/// How a query is compared with the text of a site.
public enum SiteFilterMatchMode: String, CaseIterable, Sendable {
    /// The field contains the query anywhere.
    case contains
    /// The field starts with the query.
    case prefix
    /// The field is exactly the query.
    case exact
}

/// Which of a site's fields a query is compared with.
public struct SiteSearchFields: OptionSet, Sendable {
    public let rawValue: Int

    public init(rawValue: Int) {
        self.rawValue = rawValue
    }

    public static let name = SiteSearchFields(rawValue: 1 << 0)
    public static let summary = SiteSearchFields(rawValue: 1 << 1)
    public static let notes = SiteSearchFields(rawValue: 1 << 2)
    public static let linkTitles = SiteSearchFields(rawValue: 1 << 3)
    public static let linkAddresses = SiteSearchFields(rawValue: 1 << 4)

    public static let all: SiteSearchFields = [.name, .summary, .notes, .linkTitles, .linkAddresses]
}

/// Narrowing a list of sites down to the ones a typed query mentions.
///
/// The searched fields are the ones the user typed themselves or accepted from
/// annotation: the name, the one-line summary, the notes, and each link's title
/// and address.
public enum SiteFilter {
    /// The sites out of `sites` that mention `query`, in the order they came in.
    ///
    /// An empty or whitespace-only query filters nothing away, which is what an
    /// empty search box has to mean.
    public static func sites(
        _ sites: [SiteOfInterest],
        matching query: String,
        mode: SiteFilterMatchMode = .contains,
        fields: SiteSearchFields = .all,
        caseSensitive: Bool = false
    ) -> [SiteOfInterest] {
        guard !sites.isEmpty else { return [] }
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return sites }
        let needle = caseSensitive ? trimmed : fold(trimmed)
        var result: [SiteOfInterest] = []
        for site in sites {
            var candidates: [String] = []
            if fields.contains(.name) { candidates.append(site.name) }
            if fields.contains(.summary), let summary = site.summary { candidates.append(summary) }
            if fields.contains(.notes) { candidates.append(site.notes) }
            for link in site.links {
                if fields.contains(.linkTitles) { candidates.append(link.title) }
                if fields.contains(.linkAddresses) { candidates.append(link.url.absoluteString) }
            }
            var found = false
            for candidate in candidates {
                let haystack = caseSensitive ? candidate : fold(candidate)
                if compare(haystack, needle, mode: mode) {
                    found = true
                    break
                }
            }
            if found {
                result.append(site)
            }
        }
        return result
    }

    /// Whether this one site mentions `query`.
    public static func matches(
        _ site: SiteOfInterest,
        query: String,
        mode: SiteFilterMatchMode = .contains,
        fields: SiteSearchFields = .all,
        caseSensitive: Bool = false
    ) -> Bool {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return true }
        let needle = caseSensitive ? trimmed : fold(trimmed)
        var candidates: [String] = []
        if fields.contains(.name) { candidates.append(site.name) }
        if fields.contains(.summary), let summary = site.summary { candidates.append(summary) }
        if fields.contains(.notes) { candidates.append(site.notes) }
        for link in site.links {
            if fields.contains(.linkTitles) { candidates.append(link.title) }
            if fields.contains(.linkAddresses) { candidates.append(link.url.absoluteString) }
        }
        for candidate in candidates {
            let haystack = caseSensitive ? candidate : fold(candidate)
            if compare(haystack, needle, mode: mode) {
                return true
            }
        }
        return false
    }

    // MARK: - Private

    private static func compare(_ haystack: String, _ needle: String, mode: SiteFilterMatchMode) -> Bool {
        switch mode {
        case .contains:
            return haystack.contains(needle)
        case .prefix:
            return haystack.hasPrefix(needle)
        case .exact:
            return haystack == needle
        }
    }

    /// Case and accents removed, so `pragette` finds `Pragette`.
    private static func fold(_ text: String) -> String {
        TextFolding.folded(text)
    }
}
