import Foundation
import FieldmarkCore

/// Asks the server what the newest build is.
///
/// One GET, on every launch, against a static file. It is deliberately
/// suspicious of the answer: a launch-time request is exactly the one that ends
/// up going through a reserve captive portal or at a domain that has lapsed, and
/// both of those answer 200 with a web page. Anything that is not a manifest
/// has to be an error, because the alternative is an app acting on a version
/// number it made up out of HTML.
public struct UpdateFeed: Sendable {
    private let http: any HTTPFetching
    private let byteLimit: Int

    /// - Parameters:
    ///   - http: The network seam; the default is a real `URLSession`.
    ///   - byteLimit: How much of an answer is worth reading. The real file is
    ///     a couple of hundred bytes; anything past this is not the file.
    public init(http: any HTTPFetching = URLSessionHTTP(), byteLimit: Int = 64 * 1024) {
        self.http = http
        self.byteLimit = byteLimit
    }

    public enum FeedError: Error, Equatable {
        case http(Int)
        case tooBig(Int)
    }

    public func manifest(at url: URL) async throws -> UpdateManifest {
        var request = URLRequest(url: url)
        request.setValue(HTTPUserAgent.app, forHTTPHeaderField: "User-Agent")
        // A manifest that came out of a cache is the one thing this request
        // must not accept: it is asked precisely because it may have changed.
        request.cachePolicy = .reloadIgnoringLocalCacheData

        let (data, response) = try await http.data(for: request)
        guard (200 ..< 300).contains(response.statusCode) else {
            throw FeedError.http(response.statusCode)
        }
        guard data.count <= byteLimit else { throw FeedError.tooBig(data.count) }

        return try UpdateManifest.decoded(from: data)
    }
}
