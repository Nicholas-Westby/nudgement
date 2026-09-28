import SwiftUI

struct EpisodeRow: View {
    let episode: Episode
    @Bindable var downloads: DownloadQueue
    @State private var confirmingDelete = false

    var body: some View {
        HStack {
            VStack(alignment: .leading) {
                Text(episode.title)
                Text(episode.show).foregroundStyle(.secondary)
            }
            Spacer()
            if downloads.isDownloading(episode) {
                ProgressView("Downloading…", value: downloads.progress(of: episode))
            }
        }
        .contextMenu {
            Button("Download Episode") { downloads.start(episode) }
            Button("Mark as Played") { episode.markPlayed() }
            Button("DELETE DOWNLOAD", role: .destructive) { confirmingDelete = true }
        }
        .alert("Delete this download?", isPresented: $confirmingDelete) {
            Button("Delete", role: .destructive) { downloads.remove(episode) }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The episode stays in your library and you can download it again at any time.")
        }
    }
}

enum DownloadError: LocalizedError {
    case diskFull
    case feedMoved

    var errorDescription: String? {
        switch self {
        case .diskFull:
            "We're really sorry, but the episode couldn't be downloaded."
        case .feedMoved:
            "This show has moved to a new feed address, and because of that the old address that the app currently has saved for it no longer works, so you will need to go to the show's page and update the feed address before new episodes can be downloaded."
        }
    }
}
