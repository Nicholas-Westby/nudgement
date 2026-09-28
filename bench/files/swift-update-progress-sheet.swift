import AppKit
import SwiftUI
import FieldmarkCore

/// What is on screen between "Update" and the app quitting to be replaced.
///
/// A sheet rather than a window, presented by `RootView` beside the alert
/// that started it. One line of status and a bar while it works; the reason
/// and a way out when it does not.
struct UpdateProgressSheet: View {
    let model: UpdateModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(model.updating.map { UpdateProgressText.title(for: $0.version) } ?? "Updating Fieldmark")
                .font(.headline)
            if case let .failed(message, download) = model.phase {
                failure(message, download: download)
            } else {
                working
            }
        }
        .padding(20)
        .frame(width: 440)
        .accessibilityIdentifier("update-progress-sheet")
    }

    private var working: some View {
        VStack(alignment: .leading, spacing: 8) {
            ProgressView(value: model.phase.progress)
            Text(UpdateProgressText.status(for: model.phase))
                .font(.callout)
                .foregroundStyle(.secondary)
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { model.cancel() }
                    .help("Stop the download. Fieldmark keeps running as it is and asks again next time.")
                    .disabled(!model.phase.isDownloading)
                    .accessibilityIdentifier("cancel-update-button")
            }
        }
    }

    private func failure(_ message: String, download: URL?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(message)
                .foregroundStyle(.red)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Spacer()
                // Absent when the swap already succeeded and only the relaunch
                // did not: the new version is installed, so there is nothing
                // useful to fetch.
                //
                // `SwiftUI.Link` would collide with `FieldmarkCore.Link`, and the
                // browser is the right site for a zip somebody installs by hand.
                if let download {
                    Button("Download Manually") { NSWorkspace.shared.open(download) }
                        .help("Open the download in your browser, to unzip and drag into Applications yourself.")
                        .accessibilityIdentifier("download-update-manually-button")
                }
                Button("Close") { model.dismissFailure() }
                    .keyboardShortcut(.defaultAction)
                    .help("Put this away. Fieldmark keeps running as it is.")
                    .accessibilityIdentifier("close-update-button")
            }
        }
    }
}
