import Foundation

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
/// Sorted keys because a check compares a whole object against a literal
/// somebody typed, and insertion order is not something either side can agree
/// on. Unreadable input answers `null` rather than failing, because the callers
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

    /// Walks `path` from `root` one segment at a time. An empty path asks for
    /// the whole document; anything the path asks for that is not there ends
    /// the walk at nothing.
    static func value(at path: String, in root: Any) -> Any? {
        var node: Any? = root
        for segment in path.split(separator: ".") {
            node = step(segment: String(segment), from: node)
            if node == nil { return nil }
        }
        return node
    }

    /// One segment of the walk.
    ///
    /// A digit indexes an array and counts from the end when it is negative,
    /// but on an object it is an ordinary key — a document is allowed a `"0"`,
    /// and reading it as an index would lose it.
    private static func step(segment: String, from node: Any?) -> Any? {
        if let object = node as? [String: Any] {
            return object[segment]
        }
        if let array = node as? [Any], let index = Int(segment) {
            let offset = index < 0 ? array.count + index : index
            return array.indices.contains(offset) ? array[offset] : nil
        }
        return nil
    }

    /// Spells a value for a shell script to read.
    static func render(_ value: Any?) -> String {
        guard let value, !(value is NSNull) else { return "null" }
        if isBoolean(value) {
            return (value as? NSNumber)?.boolValue == true ? "true" : "false"
        }
        if let string = value as? String { return string }
        if let number = value as? NSNumber { return spell(number) }
        return compactJSON(value)
    }

    /// `JSONSerialization` hands back `true` as an `NSNumber` like any other,
    /// so asking the number would spell it `1`. Only its CoreFoundation type
    /// tells the two apart.
    private static func isBoolean(_ value: Any) -> Bool {
        CFGetTypeID(value as CFTypeRef) == CFBooleanGetTypeID()
    }

    /// A whole number keeps its whole spelling; a fraction keeps its point.
    private static func spell(_ number: NSNumber) -> String {
        CFNumberIsFloatType(number as CFNumber) ? String(number.doubleValue) : String(number.int64Value)
    }

    /// Compact, keys sorted, and non-ASCII left as itself: the callers `grep`
    /// this output, and an escaped `ø` would not match a name a person typed.
    private static func compactJSON(_ value: Any) -> String {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(
                  withJSONObject: value,
                  options: [.sortedKeys, .withoutEscapingSlashes]
              ),
              let text = String(bytes: data, encoding: .utf8)
        else { return "null" }
        return text
    }
}
