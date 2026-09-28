import Testing
@testable import FieldmarkUI

/// `Fieldmark --self-test` prints this report. The installer reads the
/// `resources:` line and refuses to install an app whose bundle came from
/// anywhere but inside the app itself.
struct ResourceSelfTestTests {
    @Test func reportNamesTheBundleAndEveryResource() {
        let report = ResourceSelfTest.run()

        #expect(report.ok)
        #expect(report.lines.first == "resources: \(FieldmarkResources.bundle.bundlePath)")
        #expect(report.lines.contains { $0.hasPrefix("airports: ") && $0 != "airports: 0" })
        #expect(report.lines.contains { $0.hasPrefix("visit-info: ") && $0 != "visit-info: 0" })
        #expect(report.lines.contains("borders: ok"))
    }
}
