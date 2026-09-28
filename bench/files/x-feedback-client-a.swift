import Foundation
import FieldmarkCore

/// Sends one piece of feedback to the app's own server.
///
/// Beside ``UpdateFeed`` and shaped like it, for the same reasons: one request,
/// a small answer, and a deliberate suspicion of anything that is not the
/// answer — a launch-time or reserve-wifi request is exactly the one that ends up
/// talking to a captive portal, and those reply 200 with a web page.
///
/// `attempts: 1` on the default transport is load-bearing. ``URLSessionHTTP``
/// retries 429 and 5xx by default; retrying a 429 is pointless here, because
/// the window is a day, and retrying a 5xx risks a second insert — which would
/// burn two of the ten daily slots on one message.
public struct FeedbackClient: Sendable {
    public enum FeedbackError: Error, Equatable {
        /// No address in this build, no route there, or no answer.
        case unavailable
        /// Ten have already been accepted from here today.
        case dailyLimit
        /// The server would not take it, and said why.
        case rejected(String)
        /// A 5xx, or a 2xx carrying no id.
        case server(Int)
    }

    /// Not `private` only so a test can read back the deadlines and the
    /// attempt count the default transport was built with — the same reason
    /// ``URLSessionHTTP/session`` is not private.
    let http: any HTTPFetching
    private let endpoint: URL?
    private let byteLimit: Int

    /// - Parameters:
    ///   - endpoint: Where to post. `nil` in every build with no `UPDATE_URL` —
    ///     every `swift run`, every test host — and ``send(user:feedback:version:)``
    ///     then refuses without touching the network.
    ///   - byteLimit: How much of an answer is worth reading. The real one is a
    ///     dozen bytes; anything past this is not it.
    public init(
        http: any HTTPFetching = URLSessionHTTP(timeout: 15, resourceTimeout: 30, attempts: 1),
        endpoint: URL? = AppBuild.current.feedbackURL,
        byteLimit: Int = 4 * 1024
    ) {
        self.http = http
        self.endpoint = endpoint
        self.byteLimit = byteLimit
    }

    /// Whether there is anywhere to send to. ``FeedbackModel`` reads it so that
    /// Send is dead rather than absent, leaving somewhere to explain why.
    public var hasEndpoint: Bool {
        endpoint != nil
    }

    /// What goes over the wire. `.sortedKeys` is what makes the exact bytes
    /// assertable in a test.
    private struct Payload: Encodable {
        let feedback: String
        let user: String
        let version: String
    }

    /// The id of the stored row.
    public func send(user: String, feedback: String, version: String) async throws -> Int {
        guard let endpoint else { throw FeedbackError.unavailable }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(HTTPUserAgent.app, forHTTPHeaderField: "User-Agent")
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        request.httpBody = try encoder.encode(Payload(feedback: feedback, user: user, version: version))

        let data: Data
        let response: HTTPURLResponse
        do {
            (data, response) = try await http.data(for: request)
        } catch {
            // A dropped connection, a DNS blip, a portal that answers nothing:
            // from here they are all "there is nowhere to send this right now".
            throw FeedbackError.unavailable
        }

        switch response.statusCode {
        case 200, 201:
            guard let id = Self.id(in: data, limit: byteLimit) else {
                throw FeedbackError.server(response.statusCode)
            }
            return id
        case 400, 415:
            throw FeedbackError.rejected(Self.reason(in: data, limit: byteLimit))
        case 429:
            throw FeedbackError.dailyLimit
        // An installed copy older than the deploy that added the route.
        case 404, 405:
            throw FeedbackError.unavailable
        default:
            throw FeedbackError.server(response.statusCode)
        }
    }

    /// The `id` a 2xx carries, or nothing — including when the answer is too
    /// big to be this one, which a captive portal's login page is.
    public static func id(in data: Data, limit: Int) -> Int? {
        guard data.count <= limit,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return json["id"] as? Int
    }

    /// What the server said it would not take, or a sentence for when it said
    /// nothing readable. The sheet shows this string, so it is never empty.
    public static func reason(in data: Data, limit: Int) -> String {
        guard data.count <= limit,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let error = json["error"] as? String,
              !error.isEmpty
        else { return "the server would not take that" }
        return error
    }
}
