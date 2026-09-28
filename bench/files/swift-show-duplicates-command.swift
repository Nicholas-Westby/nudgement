import Observation
import SwiftUI
import FieldmarkPresentation

/// Where View ▸ Show Duplicates reaches the open survey.
///
/// The arrangement ``FieldNotesCommandTarget`` makes for the Format menu: the
/// app's menus live outside any window, so the survey's screen hands its
/// model over while it is on screen and takes it back when it goes.
@MainActor
@Observable
public final class DuplicatesCommandTarget {
    @ObservationIgnored private weak var detail: SurveyDetailModel?
    /// Bumped whenever the screen behind the menu changes, so a menu that read
    /// the old one draws again.
    private var screens = 0

    public init() {}

    func adopt(_ model: SurveyDetailModel) {
        detail = model
        screens += 1
    }

    /// Only while `model` is the one adopted: a screen that appeared since
    /// keeps the menu.
    func release(_ model: SurveyDetailModel) {
        guard detail === model else { return }
        detail = nil
        screens += 1
    }

    /// Whether the open survey's List shows its likely duplicates, or `nil`
    /// with no survey open.
    var isOn: Bool? {
        _ = screens
        return detail?.showsDuplicates
    }

    func show(_ on: Bool) {
        detail?.showDuplicates(on)
    }
}

/// View ▸ Show Duplicates: the List's Duplicates switch, from the menu bar.
/// Ticked while the List shows them; chosen from another view, it opens the
/// List.
public struct ShowDuplicatesMenuItem: View {
    let target: DuplicatesCommandTarget

    public init(target: DuplicatesCommandTarget) {
        self.target = target
    }

    public var body: some View {
        Toggle("Show Duplicates", isOn: Binding(get: { target.isOn ?? false }, set: { target.show($0) }))
            .disabled(target.isOn == nil)
            .accessibilityIdentifier("show-duplicates-menu-item")
    }
}
