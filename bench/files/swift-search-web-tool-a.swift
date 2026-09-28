import Foundation
import FieldmarkCore

/// Searches the web, through the app's own engine rather than the chat
/// provider's.
///
/// There is no "not configured" branch here. When the app has no
/// ``WebSearching`` port the tool is never constructed, so it never reaches the
/// model — which is better than offering a tool that always answers that it
/// cannot help, and being asked again next turn.
public struct SearchWebTool: AgentTool {
    /// Enough to tell a model what somewhere is known for, and few enough that
    /// ten of these turns still fit in a context window.
    static let defaultLimit = 6

    private let search: any WebSearching

    public init(search: any WebSearching) {
        self.search = search
    }

    public var spec: AgentToolSpec {
        AgentToolSpec(
            name: "search_web",
            description: "Search the web for background: what somewhere is known for, when to go, "
                + "what a site actually is.",
            parameters: [
                ToolParameter(name: "query", kind: .string,
                              description: "What to search for, as you would type it into a search box.",
                              isRequired: true),
                ToolParameter(name: "limit", kind: .integer,
                              description: "How many results to return. Defaults to \(Self.defaultLimit).",
                              isRequired: false),
            ]
        )
    }

    public func run(_ arguments: ToolArguments) async -> String {
        guard let query = arguments.string("query") else {
            return ToolJSON.error("search_web needs a query saying what to search for.")
        }

        do {
            let limit = ToolJSON.limit(arguments.int("limit"), default: Self.defaultLimit)
            let hits = try await search.results(for: query, limit: limit)
            return ToolJSON.encode(["results": hits.map { hit in
                ["title": hit.title, "url": hit.url.absoluteString, "snippet": hit.snippet]
            }])
        } catch {
            return ToolJSON.error("The web search for \"\(query)\" failed: \(error). Try different words.")
        }
    }
}
