import Foundation
import FieldmarkCore

/// Turns a region, town or address into one point on the map.
///
/// One point, not five. Handing back every candidate is how a model picks the
/// Springfield in the wrong country, so the ranking that the rest of the app
/// already trusts picks the winner here too, using the country the text itself
/// stated if it stated one.
public struct GeocodeTool: AgentTool {
    private let geocoder: any Geocoder
    private let ledger: CoordinateLedger

    public init(geocoder: any Geocoder, ledger: CoordinateLedger) {
        self.geocoder = geocoder
        self.ledger = ledger
    }

    public var spec: AgentToolSpec {
        AgentToolSpec(
            name: "geocode",
            description: "Turn a region, town or address into a single point on the map.",
            parameters: [
                ToolParameter(name: "site", kind: .string,
                              description: "The site to look up, e.g. \"Quelavik, Norway\". "
                                  + "Name the country when the town's name is not unique.",
                              isRequired: true),
            ]
        )
    }

    public func run(_ arguments: ToolArguments) async -> String {
        guard let site = arguments.string("site") else {
            return ToolJSON.error("geocode needs a site to look up.")
        }

        let candidates: [GeocodeCandidate]
        do {
            candidates = try await geocoder.candidates(for: site)
        } catch {
            return ToolJSON.error("Looking up \"\(site)\" failed: \(error). Try again with the country named.")
        }

        guard let best = GeocodeRanking.best(candidates,
                                             preferredCountry: GeocodeRanking.statedCountry(in: site))
        else {
            return ToolJSON.error("The map does not know where \"\(site)\" is. "
                + "Try a larger town nearby, or add the country.")
        }

        // Written down before it is answered: add_site will refuse any
        // coordinate this run has not actually produced.
        ledger.record(best.coordinate)
        return ToolJSON.encode(ToolJSON.object([
            "latitude": best.coordinate.latitude,
            "longitude": best.coordinate.longitude,
            "name": best.name,
            "locality": best.locality,
            "country": best.country,
        ]))
    }
}
