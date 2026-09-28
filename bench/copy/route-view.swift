import SwiftUI
import FieldmarkCore
import FieldmarkPresentation
import FieldmarkServices

/// A List-based view for editing a survey's route: reorder stops,
/// set date + optional time per stop, add stops from sites not yet in
/// the route, and remove stops.
public struct RouteView: View {
    @Bindable var model: SurveyDetailModel
    /// Up while the user is being asked whether to have their order rewritten.
    @State private var isConfirmingShorten = false
    /// Up while the user is choosing when the outing starts and how long it is.
    @State private var isPlanning = false
    /// Up while the user is being asked whether a new plan may replace the outing
    /// they already have.
    @State private var isConfirmingReplan = false
    @State private var pendingPlan: (start: Date, days: Int)?

    public init(model: SurveyDetailModel) {
        self.model = model
    }

    public var body: some View {
        List {
            ForEach(model.route.stops) { stop in
                stopRow(stop)
            }
            .onMove { fromOffsets, toOffset in
                model.moveStops(fromOffsets: fromOffsets, toOffset: toOffset)
            }
            .onDelete { offsets in
                model.removeStops(atOffsets: offsets)
            }
        }
        .accessibilityIdentifier("route-list")
        .overlay {
            if model.sites.isEmpty {
                AddSiteCallout()
            }
        }
        // Every label a `Label` rather than a bare `Image`, for the words Icon
        // and Text mode shows under it — see `SurveyDetailToolbar`.
        .toolbar {
            ToolbarItem {
                Menu {
                    ForEach(addableSites) { site in
                        Button {
                            model.addStop(siteID: site.id, date: Date())
                        } label: {
                            Text(site.name)
                        }
                    }
                } label: {
                    Label("Add Stop", systemImage: "plus")
                }
                .accessibilityIdentifier("route-add-stop")
                .help("Add a stop to the route")
                .disabled(addableSites.isEmpty)
            }
            ToolbarItem {
                Button {
                    isConfirmingShorten = true
                } label: {
                    Label("Shorten Route", systemImage: "arrow.triangle.turn.up.right.diamond")
                }
                .disabled(!model.canShortenRoute)
                .accessibilityIdentifier("optimize-route-button")
                // Dead for two unrelated reasons, so the tooltip says which one
                // — the same conditional-`help` shape `DiscoverButton` uses for
                // its own dead state, and the only explanation a greyed-out
                // toolbar square can carry.
                .help(RouteSaving.help(for: model.routeReadiness))
            }
            ToolbarItem {
                Button {
                    isPlanning = true
                } label: {
                    Label("Plan Days", systemImage: "calendar.badge.plus")
                }
                .disabled(!model.canPlanDays)
                .accessibilityIdentifier("plan-days-button")
                .help(DayPlanPopover.buttonHelp(canPlan: model.canPlanDays))
                .popover(isPresented: $isPlanning, arrowEdge: .bottom) {
                    DayPlanPopover(
                        days: model.suggestedDays,
                        startDate: model.route.stops.map(\.date).min() ?? Date()
                    ) { start, days in
                        isPlanning = false
                        plan(startingOn: start, days: days)
                    }
                }
            }
        }
        // Both of these throw away an order the user may have built by hand, so
        // both ask — and both say what they are about to do rather than only
        // that they are about to do something.
        //
        // Both confirmations are destructive, and wear the role to prove it.
        // Reorder used to be an ordinary button next to Replace's red one, which
        // read as the safer of the two when it rewrites just as much: every stop
        // moves and every date the user paired with a site is dealt out again.
        .alert(
            RouteSaving.question(stops: model.route.stops.count, meters: model.routeSavingMeters),
            isPresented: $isConfirmingShorten
        ) {
            Button("Reorder", role: .destructive) { model.optimizeRoute() } // no-help: self-evident label
            Button("Cancel", role: .cancel) {} // no-help: self-evident label
        } message: {
            Text(RouteSaving.explanation)
        }
        .alert("Replace the outing you have?", isPresented: $isConfirmingReplan) {
            Button("Replace", role: .destructive) { // no-help: self-evident label
                if let pendingPlan {
                    model.planDays(startingOn: pendingPlan.start, days: pendingPlan.days)
                }
                pendingPlan = nil
            }
            Button("Cancel", role: .cancel) { pendingPlan = nil } // no-help: self-evident label
        } message: {
            Text("A plan is built from every saved site, so it replaces the stops already here.")
        }
        .onAppear {
            if model.route.stops.isEmpty {
                model.loadRoute()
            }
        }
    }

    /// Build the plan, asking first when there is an outing to lose.
    private func plan(startingOn start: Date, days: Int) {
        guard !model.route.stops.isEmpty else {
            model.planDays(startingOn: start, days: days)
            return
        }
        pendingPlan = (start, days)
        isConfirmingReplan = true
    }

    /// Sites not yet in the route, preserving the model's sites ordering.
    private var addableSites: [SiteOfInterest] {
        RoutePlanning.stopsNotIn(route: model.route, sites: model.sites)
    }

    /// Renders a single route stop row.
    @ViewBuilder
    private func stopRow(_ stop: RouteStop) -> some View {
        let site = model.sites.first { $0.id == stop.siteID }

        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                if let site {
                    Text(site.name)
                        .font(.body)
                        .foregroundStyle(.primary)
                } else {
                    Text("Deleted site")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .italic()
                }

                HStack(spacing: 8) {
                    DatePicker(
                        "",
                        selection: Binding(
                            get: { stop.date },
                            set: { newDate in
                                model.setDate(for: stop, date: newDate, includesTime: stop.includesTime)
                            }
                        ),
                        displayedComponents: stop.includesTime ? [.date, .hourAndMinute] : .date
                    )
                    .labelsHidden()
                    .datePickerStyle(.field)

                    Toggle(isOn: Binding(
                        get: { stop.includesTime },
                        set: { newValue in
                            model.setDate(for: stop, date: stop.date, includesTime: newValue)
                        }
                    )) {
                        Image(systemName: "clock")
                    }
                    .toggleStyle(.button)
                    .help("Include time of day")
                    .accessibilityIdentifier("route-time-toggle")
                }
            }

            Spacer()
        }
        .padding(.vertical, 4)
    }
}
