import Foundation

/// How the update zip arrives. A protocol so the model can be tested with a
/// download that comes from a fixture rather than a server.
public protocol UpdateDownloading: Sendable {
    /// Downloads `url` to `file`, reporting bytes so far and the total when
    /// the server said one. Throws on transport failure, on a non-2xx reply,
    /// and when the task is cancelled.
    func download(_ url: URL, to file: URL, progress: @escaping @Sendable (Int64, Int64?) -> Void) async throws
}

/// `LocalizedError`, so the sheet's "The update could not be installed: …"
/// names the status code rather than an opaque enum case.
public enum UpdateDownloadError: LocalizedError, Equatable {
    case http(Int)

    public var errorDescription: String? {
        switch self {
        case let .http(code): "the server answered HTTP \(code)"
        }
    }
}

/// A `URLSession` download task, with its progress read off the delegate.
///
/// Its own session rather than the shared one: the deadline is ten minutes,
/// which no other request in the app wants, and the cache is bypassed in both
/// directions, because a zip named by version never changes and a stale one
/// would fail the checksum for no reason anybody could see.
public struct URLSessionDownloader: UpdateDownloading {
    /// How the session is set up, made fresh for each download.
    private let configure: @Sendable () -> URLSessionConfiguration

    public init() {
        configure = Self.sessionConfiguration
    }

    /// The same downloader with its session's settings replaced, for the tests.
    ///
    /// A test hands in a `URLProtocol` that answers with a status of its own: a
    /// download against a `file://` URL never produces an `HTTPURLResponse`, so
    /// the check that refuses a non-2xx reply cannot be reached any other way.
    /// Production never passes one — the shape ``URLSessionHTTP``'s second init
    /// has, and for the same reason.
    init(configuration: @escaping @Sendable () -> URLSessionConfiguration) {
        configure = configuration
    }

    /// Ephemeral, so nothing is cached in either direction, and a ten-minute
    /// deadline for the whole download. Its own function rather than four lines
    /// inside ``download(_:to:progress:)`` for the reason
    /// ``URLSessionHTTP/configuration(timeout:resourceTimeout:)`` is one: a
    /// deadline no test can read is a deadline nothing holds.
    static func sessionConfiguration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForResource = 600
        return configuration
    }

    public func download(
        _ url: URL,
        to file: URL,
        progress: @escaping @Sendable (Int64, Int64?) -> Void
    ) async throws {
        // Before a session exists. A task already cancelled on entry would
        // otherwise race its own cancellation handler: `onCancel` fires at once
        // and calls `task.cancel()`, which can land before `task.resume()`, and
        // a download task cancelled before it was ever resumed is not obliged
        // to call its delegate at all — leaving the continuation below with
        // nothing to resume it.
        try Task.checkCancellation()
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.setValue(HTTPUserAgent.app, forHTTPHeaderField: "User-Agent")
        let delegate = Delegate(destination: file, progress: progress)
        let session = URLSession(configuration: configure(), delegate: delegate, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        let task = session.downloadTask(with: request)
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
                delegate.finish = { continuation.resume(with: $0) }
                task.resume()
            }
        } onCancel: {
            task.cancel()
        }
    }

    private final class Delegate: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
        private let destination: URL
        private let progress: @Sendable (Int64, Int64?) -> Void
        private let lock = NSLock()
        private var done = false
        var finish: ((Result<Void, any Error>) -> Void)?

        init(destination: URL, progress: @escaping @Sendable (Int64, Int64?) -> Void) {
            self.destination = destination
            self.progress = progress
        }

        private func complete(_ result: Result<Void, any Error>) {
            lock.lock()
            defer { lock.unlock() }
            guard !done else { return }
            done = true
            finish?(result)
        }

        func urlSession(_: URLSession, downloadTask _: URLSessionDownloadTask, didWriteData _: Int64,
                        totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
            let total = totalBytesExpectedToWrite == NSURLSessionTransferSizeUnknown
                ? nil
                : totalBytesExpectedToWrite
            progress(totalBytesWritten, total)
        }

        /// The move has to happen here: the file at `location` is gone the
        /// moment this method returns.
        func urlSession(_: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
            if let response = downloadTask.response as? HTTPURLResponse,
               !(200 ..< 300).contains(response.statusCode) {
                complete(.failure(UpdateDownloadError.http(response.statusCode)))
                return
            }
            do {
                try? FileManager.default.removeItem(at: destination)
                try FileManager.default.moveItem(at: location, to: destination)
                complete(.success(()))
            } catch {
                complete(.failure(error))
            }
        }

        func urlSession(_: URLSession, task _: URLSessionTask, didCompleteWithError error: (any Error)?) {
            if let error { complete(.failure(error)) }
        }
    }
}
