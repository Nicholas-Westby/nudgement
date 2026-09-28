import Foundation

/// A raster image format the sniffer can recognise.
public enum SniffedImageFormat: String, CaseIterable, Sendable {
    case png, jpeg, gif, tiff, bmp, webp, heif
}

/// Recognises one image format from the first bytes of a file.
public protocol ImageFormatDetecting: Sendable {
    /// The format this detector recognises.
    var format: SniffedImageFormat { get }
    /// The fewest bytes needed to decide.
    var minimumLength: Int { get }
    /// Whether `bytes` begin with this format's signature.
    func matches(_ bytes: [UInt8]) -> Bool
}

/// A detector that compares a fixed signature at a fixed offset.
public struct SignatureDetector: ImageFormatDetecting {
    public let format: SniffedImageFormat
    public let signature: [UInt8]
    public let offset: Int

    public init(format: SniffedImageFormat, signature: [UInt8], offset: Int = 0) {
        self.format = format
        self.signature = signature
        self.offset = offset
    }

    public var minimumLength: Int {
        offset + signature.count
    }

    public func matches(_ bytes: [UInt8]) -> Bool {
        guard !signature.isEmpty else { return false }
        guard offset >= 0 else { return false }
        guard bytes.count >= minimumLength else { return false }
        for (index, expected) in signature.enumerated() {
            if bytes[offset + index] != expected {
                return false
            }
        }
        return true
    }
}

/// A detector that accepts any one of several signatures.
public struct AnySignatureDetector: ImageFormatDetecting {
    public let format: SniffedImageFormat
    public let detectors: [SignatureDetector]

    public var minimumLength: Int {
        detectors.map(\.minimumLength).min() ?? 0
    }

    public func matches(_ bytes: [UInt8]) -> Bool {
        detectors.contains { $0.matches(bytes) }
    }
}

/// A detector for ISO base media files, which name their brand after an `ftyp` box.
public struct ISOBMFFDetector: ImageFormatDetecting {
    public let format: SniffedImageFormat = .heif
    public let brands: [String]

    public var minimumLength: Int { 12 }

    public func matches(_ bytes: [UInt8]) -> Bool {
        guard bytes.count >= minimumLength else { return false }
        guard SignatureDetector(format: .heif, signature: Array("ftyp".utf8), offset: 4).matches(bytes) else {
            return false
        }
        let brandBytes = Array(bytes[8 ..< 12])
        guard let brand = String(bytes: brandBytes, encoding: .ascii) else { return false }
        return brands.contains(brand)
    }
}

/// Holds the detectors the sniffer tries, in order.
public struct ImageFormatDetectorRegistry: Sendable {
    public private(set) var detectors: [any ImageFormatDetecting]

    public init(detectors: [any ImageFormatDetecting]) {
        self.detectors = detectors
    }

    /// Adds a detector to the end of the list.
    public mutating func register(_ detector: any ImageFormatDetecting) {
        detectors.append(detector)
    }

    /// The detectors for every format the app accepts.
    public static let standard = ImageFormatDetectorRegistry(detectors: [
        SignatureDetector(format: .png, signature: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        SignatureDetector(format: .jpeg, signature: [0xFF, 0xD8, 0xFF]),
        SignatureDetector(format: .gif, signature: Array("GIF8".utf8)),
        AnySignatureDetector(format: .tiff, detectors: [
            SignatureDetector(format: .tiff, signature: [0x49, 0x49, 0x2A, 0x00]),
            SignatureDetector(format: .tiff, signature: [0x4D, 0x4D, 0x00, 0x2A]),
        ]),
        SignatureDetector(format: .bmp, signature: Array("BM".utf8)),
        AnySignatureDetector(format: .webp, detectors: [
            SignatureDetector(format: .webp, signature: Array("RIFF".utf8)),
        ]),
        ISOBMFFDetector(brands: ["heic", "heix", "hevc", "hevx", "mif1", "msf1", "avif"]),
    ])
}

/// Detects raster image formats by inspecting magic bytes at the head of raw data.
public enum ImageSniffer {
    /// Returns `true` iff `data` begins with a recognized raster-image signature.
    public static func isImage(_ data: Data, registry: ImageFormatDetectorRegistry = .standard) -> Bool {
        format(of: data, registry: registry) != nil
    }

    /// The format `data` is in, or `nil` when it is not a recognised image.
    public static func format(of data: Data, registry: ImageFormatDetectorRegistry = .standard) -> SniffedImageFormat? {
        guard !data.isEmpty else { return nil }
        let bytes = Array(data.prefix(16))
        guard !bytes.isEmpty else { return nil }
        for detector in registry.detectors {
            if bytes.count < detector.minimumLength {
                continue
            }
            if detector.matches(bytes) {
                if detector.format == .webp {
                    guard bytes.count >= 12, Array(bytes[8 ..< 12]) == Array("WEBP".utf8) else { continue }
                }
                return detector.format
            }
        }
        return nil
    }
}
