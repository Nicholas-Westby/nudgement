import Foundation

/// The one string somebody copies out of the share sheet and pastes into the
/// join sheet: `FIELDMARK-<shareID>-<inviteToken>`, 72 characters.
///
/// Hex on both sides is deliberate. The member token is 32 random bytes as
/// base64url, which contains `-`, and a code built from one could not be split
/// at all. The server parses this again in JS rather than trusting a client's
/// split, so the two implementations have to agree — including on the empty
/// group, which is why the split below keeps empty subsequences.
public enum InviteCode {
    public static let prefix = "FIELDMARK-"
    /// Each group is 16 random bytes as lowercase hex.
    public static let groupLength = 32
    /// 7 + 32 + 1 + 32.
    public static let length = 72

    private static let hexDigits = Set("0123456789abcdef")

    public static func format(shareID: String, token: String) -> String {
        "\(prefix)\(shareID)-\(token)"
    }

    /// The two halves, or `nil` when the text is not a code at all.
    ///
    /// Trims whitespace and newlines — a pasted code arrives with both — strips
    /// a `FIELDMARK-` prefix in any case, and requires exactly two groups of
    /// exactly 32 hex characters, lowercased. Nothing is rejected for looking
    /// foreign; the server decides whether a code is real. `nil` here is
    /// `ShareError.malformedInvite`, raised before any request goes out.
    public static func parse(_ text: String) -> (shareID: String, token: String)? {
        guard !text.isEmpty else { return nil }
        var rest = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !rest.isEmpty else { return nil }
        if rest.count >= prefix.count, rest.prefix(prefix.count).uppercased() == prefix {
            rest = String(rest.dropFirst(prefix.count))
        }
        guard !rest.isEmpty, rest.contains("-") else { return nil }
        // Empty subsequences kept, so "a--b" is three groups and is refused,
        // exactly as the server's own `rest.split("-")` refuses it.
        let groups = rest.split(separator: "-", omittingEmptySubsequences: false)
        guard groups.count == 2 else { return nil }
        guard let first = groups.first, let last = groups.last else { return nil }
        let shareID = first.lowercased()
        let token = last.lowercased()
        guard !shareID.isEmpty, !token.isEmpty else { return nil }
        guard shareID.count == groupLength, token.count == groupLength else { return nil }
        guard isHexGroup(shareID), isHexGroup(token) else { return nil }
        return (shareID, token)
    }

    /// `Character.isHexDigit` also accepts fullwidth forms, which no shareID
    /// can contain; the set is spelled out so a code is hex in the one sense
    /// the server means.
    private static func isHexGroup(_ text: String) -> Bool {
        guard !text.isEmpty else { return false }
        return text.count == groupLength && text.allSatisfy { hexDigits.contains($0) }
    }
}
