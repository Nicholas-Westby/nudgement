import Foundation

// MARK: - Path

/// One segment of a dotted path, as it was written.
public struct JSONPathSegment: Equatable, Sendable {
    /// The segment's text.
    public let rawValue: String

    public init(_ rawValue: String) {
        self.rawValue = rawValue
    }

    /// The segment read as an array index, when it is a whole number.
    ///
    /// A digit indexes an array and counts from the end when it is negative,
    /// but on an object it is an ordinary key — a document is allowed a `"0"`,
    /// and reading it as an index would lose it.
    public var index: Int? {
        Int(rawValue)
    }
}

/// A dotted path, split into its segments.
public struct JSONPathExpression: Equatable, Sendable {
    /// The segments, in the order the walk takes them.
    public let segments: [JSONPathSegment]

    /// Splits `path` on dots. An empty path asks for the whole document.
    public init(_ path: String) {
        segments = path.split(separator: ".").map { JSONPathSegment(String($0)) }
    }
}

// MARK: - Rendering

/// Spells one kind of JSON value for a shell script.
protocol JSONValueRenderer: Sendable {
    /// The spelling of `value`, or `nil` when this renderer does not handle it.
    func render(_ value: Any) -> String?
}

/// `null` stays `null`.
struct NullRenderer: JSONValueRenderer {
    func render(_ value: Any) -> String? {
        value is NSNull ? "null" : nil
    }
}

/// `JSONSerialization` hands back `true` as an `NSNumber` like any other, so
/// asking the number would spell it `1`. Only its CoreFoundation type tells the
/// two apart.
struct BooleanRenderer: JSONValueRenderer {
    func render(_ value: Any) -> String? {
        guard CFGetTypeID(value as CFTypeRef) == CFBooleanGetTypeID() else { return nil }
        return (value as? NSNumber)?.boolValue == true ? "true" : "false"
    }
}

/// A string is itself, without the quotes.
struct StringRenderer: JSONValueRenderer {
    func render(_ value: Any) -> String? {
        value as? String
    }
}

/// A whole number keeps its whole spelling; a fraction keeps its point.
struct NumberRenderer: JSONValueRenderer {
    func render(_ value: Any) -> String? {
        guard let number = value as? NSNumber else { return nil }
        return CFNumberIsFloatType(number as CFNumber) ? String(number.doubleValue) : String(number.int64Value)
    }
}

/// Compact, keys sorted, and non-ASCII left as itself: the callers `grep` this
/// output, and an escaped `ø` would not match a name a person typed.
struct CompactJSONRenderer: JSONValueRenderer {
    func render(_ value: Any) -> String? {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(
                  withJSONObject: value,
                  options: [.sortedKeys, .withoutEscapingSlashes]
              ),
              let text = String(bytes: data, encoding: .utf8)
        else { return nil }
        return text
    }
}

/// Asks each renderer in turn and answers with the first spelling.
///
/// The order matters: a boolean is also an `NSNumber`, so it has to be asked
/// about before the number renderer sees it.
struct JSONRendererChain: Sendable {
    let renderers: [any JSONValueRenderer]

    /// The chain the shell scripts rely on.
    static let standard = JSONRendererChain(renderers: [
        NullRenderer(),
        BooleanRenderer(),
        StringRenderer(),
        NumberRenderer(),
        CompactJSONRenderer(),
    ])

    func render(_ value: Any?) -> String {
        guard let value else { return "null" }
        for renderer in renderers {
            if let text = renderer.render(value) {
                return text
            }
        }
        return "null"
    }
}

// MARK: - Reading

/// Reads one value out of a JSON document at a dotted path, and spells the
/// answer the way a shell script needs to read it.
///
/// `Scripts/e2e.sh` asks this about a hundred questions a run — is `ok` true,
/// what is `selectedPlace.insight.rating`, which places came back from
/// discovery — and compares the answers against literals or pipes them into
/// `grep`. So the spelling is the contract:
///
/// | in the document | printed |
/// |---|---|
/// | a string | itself, without the quotes |
/// | a whole number | `812` |
/// | a fraction | `4.6` |
/// | `true` / `false` | `true` / `false` |
/// | an object or an array | compact JSON, keys sorted |
/// | `null`, a path that is not there, input that is not JSON | `null` |
///
/// Unreadable input answers `null` rather than failing, because the callers
/// run under `set -euo pipefail`, where an error inside `$(…)` ends the run
/// instead of failing the one assertion that asked.
public enum JSONPath {
    /// The value at `path` in the JSON document `data`, spelled for a shell.
    public static func read(_ data: Data, at path: String) -> String {
        guard let root = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else {
            return "null"
        }
        return render(value(at: path, in: root))
    }

    /// Walks `path` from `root` one segment at a time. Anything the path asks
    /// for that is not there ends the walk at nothing.
    static func value(at path: String, in root: Any) -> Any? {
        let expression = JSONPathExpression(path)
        var node: Any? = root
        for segment in expression.segments {
            node = step(segment: segment, from: node)
            if node == nil { return nil }
        }
        return node
    }

    /// One segment of the walk.
    private static func step(segment: JSONPathSegment, from node: Any?) -> Any? {
        if let object = node as? [String: Any] {
            return object[segment.rawValue]
        }
        if let array = node as? [Any], let index = segment.index {
            let offset = index < 0 ? array.count + index : index
            return array.indices.contains(offset) ? array[offset] : nil
        }
        return nil
    }

    /// Spells a value for a shell script to read.
    static func render(_ value: Any?) -> String {
        JSONRendererChain.standard.render(value)
    }
}
