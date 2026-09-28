import SwiftUI
import FieldmarkServices

/// Describes the visual styling applied to a gallery status bar.
///
/// Conforming types provide every metric the status bar uses when it lays
/// itself out, so the look of the bar can be swapped without touching the view.
protocol GalleryStatusBarStyling {
    /// The height of the status bar.
    var height: CGFloat { get }
    /// The width of the size slider.
    var sliderWidth: CGFloat { get }
    /// The horizontal padding applied to the bar's contents.
    var horizontalPadding: CGFloat { get }
    /// The spacing between the bar's items.
    var itemSpacing: CGFloat { get }
    /// Whether the small and large photo icons are shown beside the slider.
    var showsSizeIcons: Bool { get }
    /// Whether a separator line is drawn along the top edge.
    var showsTopSeparator: Bool { get }
}

/// The default styling for the gallery status bar, matching the Finder.
struct DefaultGalleryStatusBarStyle: GalleryStatusBarStyling {
    var height: CGFloat = 30
    var sliderWidth: CGFloat = 120
    var horizontalPadding: CGFloat = 12
    var itemSpacing: CGFloat = 8
    var showsSizeIcons: Bool = true
    var showsTopSeparator: Bool = true
}

/// The strip along the bottom of the gallery, the way the Finder has one: how
/// many photos there are on the left, and on the right a slider for how big to
/// draw them, between a small photo and a large one.
struct GalleryStatusBar: View {
    /// "1 photo", "44 photos".
    let countLine: String
    /// The size the slider shows and changes — see ``GalleryPhotoSize``.
    @Binding var photoSize: Double
    /// The styling used to lay out the bar.
    var style: any GalleryStatusBarStyling = DefaultGalleryStatusBarStyle()

    /// How tall the strip is, the Finder's own.
    static let height: CGFloat = DefaultGalleryStatusBarStyle().height

    /// The count line to display, falling back to an empty string.
    private var displayedCountLine: String {
        countLine.isEmpty ? "" : countLine
    }

    /// The range of the slider.
    private var sliderRange: ClosedRange<Double> {
        GalleryPhotoSize.range
    }

    /// The photo size clamped into the slider's range.
    private var clampedPhotoSize: Binding<Double> {
        Binding(
            get: { min(max(photoSize, sliderRange.lowerBound), sliderRange.upperBound) },
            set: { newValue in
                guard newValue.isFinite else { return }
                photoSize = min(max(newValue, sliderRange.lowerBound), sliderRange.upperBound)
            }
        )
    }

    var body: some View {
        HStack(spacing: style.itemSpacing) {
            countLabel
            Spacer(minLength: 16)
            if style.showsSizeIcons {
                sizeIcon(scale: .small)
            }
            sizeSlider
            if style.showsSizeIcons {
                sizeIcon(scale: .large)
            }
        }
        .font(.callout)
        .padding(.horizontal, style.horizontalPadding)
        .frame(height: style.height)
        .background(.bar)
        .overlay(alignment: .top) {
            if style.showsTopSeparator {
                topSeparator
            }
        }
    }

    /// The label showing how many photos there are.
    private var countLabel: some View {
        Text(displayedCountLine)
            .foregroundStyle(.secondary)
            .accessibilityIdentifier("gallery-photo-count")
    }

    /// The slider that changes the photo size.
    private var sizeSlider: some View {
        // Live as it moves: the grid follows the value, and the thumbnails
        // are decoded in 64-pixel steps, so a drag asks for few decodes.
        Slider(value: clampedPhotoSize, in: sliderRange)
            .controlSize(.small)
            .frame(width: style.sliderWidth)
            .accessibilityLabel("Photo size")
            .help("Photo size")
            .accessibilityIdentifier("gallery-photo-size")
    }

    /// A photo icon at the given scale.
    private func sizeIcon(scale: Image.Scale) -> some View {
        Image(systemName: "photo")
            .imageScale(scale)
            .foregroundStyle(.secondary)
            .accessibilityHidden(true)
    }

    /// The separator drawn along the top edge.
    private var topSeparator: some View {
        Rectangle()
            .fill(.separator)
            .frame(height: 1)
    }
}
