import Foundation

/// Frames a Server-Sent Events body, one byte at a time.
///
/// Hand-written rather than built on `AsyncLineSequence`, and the reason is not
/// taste: `.lines` silently drops every empty line, and the empty line is
/// exactly what separates one SSE event from the next. Nothing built on it can
/// tell where an event ends, or tell two `data:` lines of one event from two
/// events of one line each.
///
/// Only what a chat completion needs, which is the `data:` field. `event:`,
/// `id:` and `retry:` are read and thrown away rather than left to fall through
/// as payload, and a comment line — the keepalive some providers send between
/// chunks — is skipped, because handing one to a JSON decoder throws and ends
/// the run mid-stream.
struct ServerSentEvents {
    private var line: [UInt8] = []
    private var payload: [String] = []
    /// Whether the last byte was a carriage return, so a `\n` straight after it
    /// is the other half of one break rather than a second empty line.
    private var afterCarriageReturn = false

    /// Feed one byte. Answers a completed event's payload, when this byte ended
    /// one, and `nil` the rest of the time.
    mutating func read(_ byte: UInt8) -> String? {
        let wasAfterCarriageReturn = afterCarriageReturn
        afterCarriageReturn = byte == Self.carriageReturn

        guard byte == Self.newline || byte == Self.carriageReturn else {
            line.append(byte)
            return nil
        }
        // The `\n` of a `\r\n` closed its line already.
        if byte == Self.newline, wasAfterCarriageReturn, line.isEmpty { return nil }
        return endOfLine()
    }

    /// What a body that stopped without its last blank line left behind. A
    /// dropped connection is still worth what already arrived.
    mutating func finish() -> String? {
        _ = endOfLine()
        return dispatch()
    }

    private mutating func endOfLine() -> String? {
        defer { line.removeAll(keepingCapacity: true) }
        guard !line.isEmpty else { return dispatch() }
        guard line.first != Self.colon else { return nil }
        guard line.starts(with: Self.dataField) else { return nil }

        var value = line.dropFirst(Self.dataField.count)
        // Exactly one space, not a trim: a blanket trim would eat a payload's
        // own leading whitespace.
        if value.first == Self.space { value = value.dropFirst() }
        // The rule prefers the failable `String(bytes:encoding:)`, but a chunk
        // that will not decode must not end the run: the lossy, total form
        // turns a mangled byte into a replacement character and keeps reading,
        // where the optional form would drop the whole event.
        // swiftlint:disable:next optional_data_string_conversion
        payload.append(String(decoding: value, as: UTF8.self))
        return nil
    }

    /// A blank line ends the event. Several `data:` lines in one event are one
    /// payload joined by newlines, which is what the spec says and what nothing
    /// built on `.lines` could reconstruct.
    private mutating func dispatch() -> String? {
        guard !payload.isEmpty else { return nil }
        defer { payload.removeAll(keepingCapacity: true) }
        return payload.joined(separator: "\n")
    }

    private static let newline = UInt8(ascii: "\n")
    private static let carriageReturn = UInt8(ascii: "\r")
    private static let colon = UInt8(ascii: ":")
    private static let space = UInt8(ascii: " ")
    private static let dataField = Array("data:".utf8)
}
