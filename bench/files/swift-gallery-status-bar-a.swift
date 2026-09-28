import SwiftUI
import FieldmarkServices

/// The strip along the bottom of the gallery, the way the Finder has one: how
/// many photos there are on the left, and on the right a slider for how big to
/// draw them, between a small photo and a large one.
struct GalleryStatusBar: View {
    /// "1 photo", "44 photos".
    let countLine: String
    /// The size the slider shows and changes — see ``GalleryPhotoSize``.
    @Binding var photoSize: Double

    /// How tall the strip is, the Finder's own.
    static let height: CGFloat = 30

    var body: some View {
        HStack(spacing: 8) {
            Text(countLine)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("gallery-photo-count")
            Spacer(minLength: 16)
            Image(systemName: "photo")
                .imageScale(.small)
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            // Live as it moves: the grid follows the value, and the thumbnails
            // are decoded in 64-pixel steps, so a drag asks for few decodes.
            Slider(value: $photoSize, in: GalleryPhotoSize.range)
                .controlSize(.small)
                .frame(width: 120)
                .accessibilityLabel("Photo size")
                .help("Photo size")
                .accessibilityIdentifier("gallery-photo-size")
            Image(systemName: "photo")
                .imageScale(.large)
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
        }
        .font(.callout)
        .padding(.horizontal, 12)
        .frame(height: Self.height)
        .background(.bar)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(.separator)
                .frame(height: 1)
        }
    }
}
