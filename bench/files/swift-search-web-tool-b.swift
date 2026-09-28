import Foundation
import FieldmarkCore

/// Options that change how ``SearchWebTool`` searches and what it returns.
public struct SearchWebToolOptions: Sendable, Equatable {
    /// How many results to return when the model does not say.
    public var defaultLimit: Int
    /// The most results the model may ask for.
    public var maximumLimit: Int
    /// Whether each result's snippet is included in the answer.
    public var includesSnippets: Bool
    /// The longest a snippet may be before it is cut, or `nil` for no cut.
    public var maximumSnippetLength: Int?
    /// Whether results with the same address are collapsed into one.
    public var removesDuplicateURLs: Bool

    public init(
        defaultLimit: Int = 6,
        maximumLimit: Int = 20,
        includesSnippets: Bool = true,
        maximumSnippetLength: Int? = nil,
        removesDuplicateURLs: Bool = false
    ) {
        self.defaultLimit = defaultLimit
        self.maximumLimit = maximumLimit
        self.includesSnippets = includesSnippets
        self.maximumSnippetLength = maximumSnippetLength
        self.removesDuplicateURLs = removesDuplicateURLs
    }

    public static let `default` = SearchWebToolOptions()
}

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
    private let options: SearchWebToolOptions

    public init(search: any WebSearching, options: SearchWebToolOptions = .default) {
        self.search = search
        self.options = options
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
                              description: "How many results to return. Defaults to \(options.defaultLimit).",
                              isRequired: false),
            ]
        )
    }

    public func run(_ arguments: ToolArguments) async -> String {
        guard let rawQuery = arguments.string("query") else {
            return ToolJSON.error("search_web needs a query saying what to search for.")
        }
        let query = rawQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            return ToolJSON.error("search_web needs a query saying what to search for.")
        }

        do {
            let limit = resolvedLimit(arguments.int("limit"))
            let hits = try await performSearch(query: query, limit: limit)
            return ToolJSON.encode(["results": format(hits)])
        } catch {
            return ToolJSON.error("The web search for \"\(query)\" failed: \(error). Try different words.")
        }
    }

    private func performSearch(query: String, limit: Int) async throws -> [WebSearchHit] {
        try await search.results(for: query, limit: limit)
    }

    private func resolvedLimit(_ requested: Int?) -> Int {
        let base = ToolJSON.limit(requested, default: options.defaultLimit)
        guard base > 0 else { return options.defaultLimit }
        guard base <= options.maximumLimit else { return options.maximumLimit }
        return base
    }

    private func format(_ hits: [WebSearchHit]) -> [[String: String]] {
        var seen = Set<String>()
        var results: [[String: String]] = []
        for hit in hits {
            let address = hit.url.absoluteString
            guard !address.isEmpty else { continue }
            if options.removesDuplicateURLs {
                if seen.contains(address) { continue }
                seen.insert(address)
            }
            var entry: [String: String] = ["title": hit.title.isEmpty ? address : hit.title, "url": address]
            if options.includesSnippets {
                entry["snippet"] = snippet(hit.snippet)
            }
            results.append(entry)
        }
        return results
    }

    private func snippet(_ text: String) -> String {
        guard let maximum = options.maximumSnippetLength, maximum > 0, text.count > maximum else { return text }
        return String(text.prefix(maximum))
    }
}
