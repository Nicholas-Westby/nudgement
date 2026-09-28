import Foundation
import Testing
@testable import FieldmarkServices

/// The detached shell that opens the new copy after this one quits.
@Suite(.serialized)
struct UpdateRelauncherTests {
    @Test func opensTheAppOnceTheGivenPidHasGone() async throws {
        let sleeper = Process()
        sleeper.executableURL = URL(fileURLWithPath: "/bin/sleep")
        sleeper.arguments = ["0.5"]
        try sleeper.run()
        let tmp = TempDir(prefix: "fieldmark-relaunch")
        defer { tmp.cleanup() }
        let marker = tmp.url.appendingPathComponent("marker")

        // /usr/bin/touch as the opener: the "app" is a file that appears.
        try UpdateRelauncher.start(app: marker, pid: sleeper.processIdentifier, opener: "/usr/bin/touch")

        try await Task.sleep(for: .milliseconds(150))
        #expect(!FileManager.default.fileExists(atPath: marker.path), "opened before the old copy had quit")
        for _ in 0 ..< 40 where !FileManager.default.fileExists(atPath: marker.path) {
            try await Task.sleep(for: .milliseconds(100))
        }
        #expect(FileManager.default.fileExists(atPath: marker.path))
    }
}
