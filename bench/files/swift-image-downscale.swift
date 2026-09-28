import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Turns downloaded image bytes into something small enough to put in a request
/// body.
///
/// A picture bound for a model is billed twice: once as bytes on the wire, once
/// as tokens in the prompt, and both scale with its size. Measured against the
/// real endpoint, the same photograph cost 656 prompt tokens at 960 px and 216
/// at 512, and the answer was the same — a museum is recognisably a museum
/// either way. Four candidates a site, dozens of sites in an auto-annotated
/// discovery run, and that difference is the whole cost of the feature.
///
/// ImageIO scales while it decodes, so the full-size bitmap never exists.
enum ImageDownscale {
    /// The longest edge a picture is worth sending at. Below the point where the
    /// judgement changes, above the point where a building stops being legible.
    static let defaultMaxPixelSide = 512

    /// JPEG quality. Enough that a facade is still a facade; low enough that a
    /// photograph of a wall is not carried pixel by pixel.
    static let quality = 0.7

    /// `data` re-encoded as a JPEG no more than `maxPixelSide` pixels on its
    /// longest edge, or `nil` when it is not an image at all — which on the open
    /// web usually means an error page arriving with a 200.
    ///
    /// Never upscales. A photo already smaller than the limit comes back at its
    /// own size, because making it bigger would cost bytes and tokens to add
    /// nothing a model can see.
    static func jpeg(_ data: Data, maxPixelSide: Int = defaultMaxPixelSide) -> Data? {
        guard !data.isEmpty, maxPixelSide > 0 else { return nil }
        let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions),
              CGImageSourceGetCount(source) > 0
        else { return nil }

        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            // Honour EXIF orientation, or a portrait photo reaches the model on
            // its side and is judged as one.
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: longEdge(of: source, noLargerThan: maxPixelSide),
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            return nil
        }
        return encode(image)
    }

    /// The pixel dimensions of encoded image bytes, without decoding them.
    /// Used by tests, and cheap enough that nothing else needs to exist for them.
    static func pixelSize(of data: Data) -> CGSize? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.doubleValue,
              let height = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.doubleValue
        else { return nil }
        return CGSize(width: width, height: height)
    }

    /// `limit`, or the image's own longest edge when that is smaller.
    ///
    /// `kCGImageSourceThumbnailMaxPixelSize` will happily enlarge, and asking it
    /// to is how a 40 px icon becomes a 512 px blur costing 216 tokens.
    private static func longEdge(of source: CGImageSource, noLargerThan limit: Int) -> Int {
        guard let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue,
              let height = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue,
              width > 0, height > 0
        else { return limit }
        return min(limit, max(width, height))
    }

    private static func encode(_ image: CGImage) -> Data? {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            data, UTType.jpeg.identifier as CFString, 1, nil
        ) else { return nil }
        CGImageDestinationAddImage(destination, image, [
            kCGImageDestinationLossyCompressionQuality: quality,
        ] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return data as Data
    }
}
