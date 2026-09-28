import SwiftUI
import FieldmarkCore
import FieldmarkPresentation

/// The right-click menu in the List and in the Category list, over the sites
/// it was opened on: the whole selection when the click landed on a selected
/// row, that row alone otherwise — the rule `.contextMenu(forSelectionType:)`
/// keeps, and the one the Finder and Mail follow.
///
/// Its own view rather than an inline `.contextMenu { }` block: ViewInspector
/// cannot see inside a context menu, so an item written in site could not be
/// asserted at all — the same reason `AnnotateSiteButton` is a named view.
///
/// Every item acts on every target, and says how many when there is more than
/// one: Finder's "Move 3 Items to Trash". An item with nothing to do is dead
/// rather than gone, because a control that vanishes reads as a bug. The
/// trailing "…" on Delete is the promise that a question comes first;
/// ``SiteDeletionPrompt`` writes it.
struct SiteRowMenu: View {
    /// The sites the menu acts on, in the order the list shows them. Never
    /// empty: a right-click on nothing shows no menu at all.
    let sites: [SiteOfInterest]
    /// The surveys the sites can be copied or moved into, in the order they
    /// are offered. Whoever hands them over leaves out the one being shown:
    /// copying sites into the outing they are already in is not what the items
    /// mean.
    let copyDestinations: [Survey]
    /// The people the sites can be filed against, in roster order.
    let spotters: [Spotter]
    /// Who an uncredited site (`spotterID == nil`) counts as — see
    /// ``SpotterReassignMenu/fallbackSpotterID``.
    let fallbackSpotterID: UUID?
    /// The sites the route already has a stop for. With every target among
    /// them, "Add to Route" has nothing to add.
    let siteIDsOnRoute: Set<UUID>
    /// False while any saved site is being annotated — the toolbar button's
    /// own rule, since pressing again would only re-ask the same sources.
    let isAnnotateAvailable: Bool
    /// The box that asks for a key, or `nil` in a preview or a snapshot.
    var apiKeyGate: APIKeyGate?
    let actions: SiteMenuActions

    var body: some View {
        let favorite = SiteMenuTitle.favorite(for: sites)
        // no-help: a menu item, which macOS shows no tooltip for
        Button(favorite.title) {
            actions.setFavorite(sites, favorite.makesFavorite)
        }
        .accessibilityIdentifier("favorite-site-menu-item")

        // A tick only when every target agrees; two people's sites together
        // tick nobody rather than whoever came first. The agreed person already
        // counts an uncredited site as the fallback, so none is passed on.
        SpotterReassignMenu(
            spotters: spotters,
            currentSpotterID: agreedSpotterID,
            fallbackSpotterID: nil,
            onSetSpotter: { actions.setSpotter(sites, $0) },
            onAddPerson: { actions.addPerson(sites) }
        )

        Menu("Category") {
            ForEach(SiteCategory.allCases, id: \.self) { category in
                Button {
                    actions.setCategory(sites, category)
                } label: {
                    Label(category.title, systemImage: SpotterFilterMenu.tick(category == sharedCategory))
                }
                .accessibilityIdentifier("category-\(category.rawValue)")
            }
        }
        .accessibilityIdentifier("category-menu")

        Divider()

        // no-help: a menu item, which macOS shows no tooltip for
        Button(SiteMenuTitle.annotate(count: sites.count)) {
            requiringAPIKey(apiKeyGate, .annotateSites(sites.count)) { actions.annotate(sites) }
        }
        .disabled(!isAnnotateAvailable)
        .accessibilityIdentifier("annotate-sites-menu-item")

        // no-help: a menu item, which macOS shows no tooltip for
        Button(SiteMenuTitle.addToRoute(count: sites.count)) {
            actions.addToRoute(sites)
        }
        .disabled(sites.allSatisfy { siteIDsOnRoute.contains($0.id) })
        .accessibilityIdentifier("add-to-route-menu-item")

        Divider()

        // Submenus because the answer is a survey, and the destinations are
        // the only thing there is to say about it. With one outing in the library
        // both are dead rather than gone: a greyed-out item says the feature is
        // there and this outing is on its own.
        Menu(SiteMenuTitle.copy(count: sites.count)) {
            destinations(idPrefix: "copy-site-destination-") { actions.copy(sites, $0) }
        }
        .disabled(copyDestinations.isEmpty)
        .accessibilityIdentifier("copy-site-menu")

        Menu(SiteMenuTitle.move(count: sites.count)) {
            destinations(idPrefix: "move-site-destination-") { actions.move(sites, $0) }
        }
        .disabled(copyDestinations.isEmpty)
        .accessibilityIdentifier("move-site-menu")

        Divider()

        // no-help: a menu item, which macOS shows no tooltip for
        Button(SiteMenuTitle.delete(count: sites.count), role: .destructive) {
            actions.delete(sites)
        }
        .accessibilityIdentifier("delete-site-menu-item")
    }

    /// One item per survey the sites could go to. Keyed on the id, never the
    /// name: two surveys can be called the same thing.
    private func destinations(idPrefix: String, onChoose: @escaping (Survey) -> Void) -> some View {
        ForEach(copyDestinations) { survey in
            Button(survey.name) { // no-help: a menu item, which macOS shows no tooltip for
                onChoose(survey)
            }
            .accessibilityIdentifier("\(idPrefix)\(survey.id.uuidString)")
        }
    }

    /// The person every target is filed under, counting an uncredited site as
    /// the fallback — or `nil` when they disagree.
    private var agreedSpotterID: UUID? {
        let effective = Set(sites.map { $0.spotterID ?? fallbackSpotterID })
        guard effective.count == 1 else { return nil }
        return effective.first ?? nil
    }

    /// The category every target shares, or `nil` when they differ.
    private var sharedCategory: SiteCategory? {
        let categories = Set(sites.map(\.category))
        return categories.count == 1 ? categories.first : nil
    }
}

// MARK: - What the items do

/// What the menu's items do, handed in so a test can see each call without a
/// model — and so the menu itself knows nothing about where sites are kept.
///
/// Every closure is handed the targets. The defaults do nothing, for a test
/// that cares about one item and not the other eight.
struct SiteMenuActions {
    var setFavorite: ([SiteOfInterest], Bool) -> Void = { _, _ in }
    var setSpotter: ([SiteOfInterest], UUID) -> Void = { _, _ in }
    /// Raises the name sheet, which a menu cannot present itself. Handed the
    /// targets so the person added can have them filed under them.
    var addPerson: ([SiteOfInterest]) -> Void = { _ in }
    var setCategory: ([SiteOfInterest], SiteCategory) -> Void = { _, _ in }
    var annotate: ([SiteOfInterest]) -> Void = { _ in }
    var addToRoute: ([SiteOfInterest]) -> Void = { _ in }
    var copy: ([SiteOfInterest], Survey) -> Void = { _, _ in }
    var move: ([SiteOfInterest], Survey) -> Void = { _, _ in }
    var delete: ([SiteOfInterest]) -> Void = { _ in }
}

// MARK: - What the items are called

/// The menu's titles, as pure functions so they can be read back in a test.
///
/// One site keeps the words the menu always had. Several are counted, the way
/// the Finder counts: "Copy 3 Sites to Another Survey", "Delete 3 Sites…".
enum SiteMenuTitle {
    /// What the favorite item says, and which way it sets the flag.
    struct FavoriteItem: Equatable {
        let title: String
        let makesFavorite: Bool
    }

    /// "Remove" only when every target is already a favorite. Anything else is
    /// "Add", and it marks them all: an add over a mix never unstars the ones
    /// already starred, which a toggle would.
    static func favorite(for sites: [SiteOfInterest]) -> FavoriteItem {
        let removes = !sites.isEmpty && sites.allSatisfy(\.isFavorite)
        let count = sites.count
        let title = switch (removes, count == 1) {
        case (true, true): "Remove from Favorites"
        case (true, false): "Remove \(count) Sites from Favorites"
        case (false, true): "Add to Favorites"
        case (false, false): "Add \(count) Sites to Favorites"
        }
        return FavoriteItem(title: title, makesFavorite: !removes)
    }

    static func annotate(count: Int) -> String {
        count == 1 ? "Annotate" : "Annotate \(count) Sites"
    }

    static func addToRoute(count: Int) -> String {
        count == 1 ? "Add to Route" : "Add \(count) Sites to Route"
    }

    static func copy(count: Int) -> String {
        count == 1 ? "Copy to Another Survey" : "Copy \(count) Sites to Another Survey"
    }

    static func move(count: Int) -> String {
        count == 1 ? "Move to Another Survey" : "Move \(count) Sites to Another Survey"
    }

    static func delete(count: Int) -> String {
        count == 1 ? "Delete…" : "Delete \(count) Sites…"
    }
}
