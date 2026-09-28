import Foundation

/// User-assigned primary category for a saved ``SiteOfInterest``.
/// Persisted as its raw `String` value in `site.json`.
/// `.other` is the default for legacy sites and the catch-all.
///
/// The canonical order of `CaseIterable` defines the grouping sort order;
/// `.other` must always be last.
public enum SiteCategory: String, CaseIterable, Codable, Sendable {
    case accommodation
    case foodAndDrink
    case sights
    case museums
    case nature
    case beaches
    case parks
    case shopping
    case nightlife
    case entertainment
    case activities
    case sports
    case wellness
    case religious
    case transport
    case other

    /// Human-readable display title.
    public var title: String {
        switch self {
        case .accommodation: "Accommodation"
        case .foodAndDrink: "Food & Drink"
        case .sights: "Sights & Landmarks"
        case .museums: "Museums & Culture"
        case .nature: "Nature & Outdoors"
        case .beaches: "Beaches & Water"
        case .parks: "Parks & Gardens"
        case .shopping: "Shopping"
        case .nightlife: "Nightlife & Bars"
        case .entertainment: "Entertainment"
        case .activities: "Activities & Tours"
        case .sports: "Sports & Recreation"
        case .wellness: "Wellness & Spa"
        case .religious: "Religious & Historic"
        case .transport: "Transport"
        case .other: "Other / Uncategorized"
        }
    }

    /// SF Symbol name for this category (macOS 14+).
    /// Every name is a valid symbol; no two cases share the same symbol.
    public var systemImage: String {
        switch self {
        case .accommodation: "bed.double"
        case .foodAndDrink: "fork.knife"
        case .sights: "binoculars"
        case .museums: "building.columns"
        case .nature: "leaf"
        case .beaches: "beach.umbrella"
        case .parks: "tree"
        case .shopping: "bag"
        case .nightlife: "wineglass"
        case .entertainment: "theatermasks"
        case .activities: "figure.hiking"
        case .sports: "sportscourt"
        case .wellness: "sparkles"
        case .religious: "cross"
        case .transport: "airplane"
        case .other: "mappin"
        }
    }
}
