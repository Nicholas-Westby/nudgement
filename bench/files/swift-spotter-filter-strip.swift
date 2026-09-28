import SwiftUI
import FieldmarkCore
import FieldmarkPresentation

/// The line above the view that says who is being shown, and offers the way back.
///
/// A named view rather than an inline `if` in `SurveyDetailView`, for the
/// reason `SiteActionStatusStrip` is one: ViewInspector cannot assert what it
/// cannot find, and this line is the only on-screen explanation for a map that
/// has gone half faint.
struct SpotterFilterStrip: View {
    @Bindable var model: SurveyDetailModel

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Text("Showing \(Self.summary(model.spotters, selected: model.spotterFilter.selected))")
                    .accessibilityIdentifier("spotter-filter-strip")
                Text("·")
                Button("Show everyone") { model.showEveryone() } // no-help: self-evident label
                    .buttonStyle(.link)
                    .accessibilityIdentifier("show-everyone-button")
                Spacer(minLength: 0)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
            Divider()
        }
    }

    /// The ticked people, in **roster** order rather than the order they were
    /// ticked in, joined the way a sentence joins them. An id nobody claims
    /// reads as `Unknown` — an imported file can name somebody this machine has
    /// never heard of, and the id is never repaired.
    static func summary(_ spotters: [Spotter], selected: Set<UUID>) -> String {
        let known = spotters.filter { selected.contains($0.id) }.map(\.name)
        let unclaimed = selected.subtracting(spotters.map(\.id))
        let names = known + unclaimed.map { _ in Spotter.unknownName }
        return names.formatted(.list(type: .and))
    }
}
