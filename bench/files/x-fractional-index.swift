import Foundation

/// Sort keys that always leave room: between any two keys there is another,
/// and there is always one before the first and after the last.
///
/// Field Notes order their blocks by these, so a paragraph inserted on one Mac
/// arrives in the same site on every other without anyone renumbering the
/// rest. A key is a base-62 fraction written without its leading "0.": `V` is
/// about a half, `0z` a little under a sixty-second. Plain `<` on `String`
/// orders them, because the digits are in ASCII order, and a key never ends in
/// `0`, so a key strictly between two others always exists.
///
/// The key between two bounded keys is the midpoint of the well-known
/// fractional-indexing algorithm (David Greenspan's `fractional-indexing`,
/// after Evan Wallace). Keys past either end step one digit instead of halving
/// the gap to the end, so a document typed paragraph after paragraph gains a
/// character of key every sixty-odd paragraphs rather than every six.
public enum FractionalIndex {
    /// Base-62 digits in ASCII order: 0-9, A-Z, a-z.
    public static let digits: [Character] = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")

    private static let base = digits.count
    private static let values: [Character: Int] = Dictionary(
        uniqueKeysWithValues: digits.enumerated().map { ($0.element, $0.offset) }
    )

    /// Whether `key` is one this type makes and can make keys around: not
    /// empty, only base-62 digits, and not ending in `0`.
    public static func isValidKey(_ key: String) -> Bool {
        guard let last = key.last, last != "0" else { return false }
        return key.allSatisfy { values[$0] != nil }
    }

    /// A key strictly between `a` and `b`, where `nil` is no bound on that
    /// side.
    ///
    /// A bound that is not a valid key, or a pair out of order, is not
    /// trusted: an invalid bound counts as no bound, and an upper bound not
    /// above the lower one is dropped. So the answer is always a valid key, and
    /// strictly between whenever both bounds are valid and `a < b`.
    public static func key(between a: String?, and b: String?) -> String {
        let (lower, upper) = trusted(a, b)
        switch (lower, upper) {
        case (nil, nil): return String(digits[base / 2])
        case let (lower?, nil): return string(after(lower))
        case let (nil, upper?): return string(before(upper))
        case let (lower?, upper?): return string(midpoint(lower, upper))
        }
    }

    /// `count` increasing keys strictly between `a` and `b`, with the bounds
    /// trusted as ``key(between:and:)`` trusts them.
    ///
    /// Spread out: between two bounds each key halves what is left, so no
    /// key is much longer than it needs to be; past either end they are
    /// consecutive steps.
    public static func keys(count: Int, between a: String?, and b: String?) -> [String] {
        guard count > 0 else { return [] }
        let (lower, upper) = trusted(a, b)
        switch (lower, upper) {
        case (nil, nil):
            let first = key(between: nil, and: nil)
            return [first] + keys(count: count - 1, between: first, and: nil)
        case (_?, nil):
            var result: [String] = []
            var previous = a
            for _ in 0 ..< count {
                let next = key(between: previous, and: nil)
                result.append(next)
                previous = next
            }
            return result
        case (nil, _?):
            var result: [String] = []
            var following = b
            for _ in 0 ..< count {
                let next = key(between: nil, and: following)
                result.append(next)
                following = next
            }
            return result.reversed()
        case (_?, _?):
            let middle = key(between: a, and: b)
            let before = count / 2
            return keys(count: before, between: a, and: middle) + [middle]
                + keys(count: count - before - 1, between: middle, and: b)
        }
    }

    /// Keys for items in their new order, changing as few as possible.
    ///
    /// Keeps every existing key in the longest strictly increasing run of
    /// valid keys (a patience sort, O(n log n)), and gives every other item —
    /// one with no key, an invalid key, a key out of order or a duplicate — a
    /// fresh key between the kept keys either side of it. One key per item,
    /// strictly increasing.
    public static func rekey(_ existing: [String?]) -> [String] {
        let valid = existing.map { key in key.flatMap { isValidKey($0) ? $0 : nil } }
        let kept = keptPositions(existing)
        var result: [String] = []
        result.reserveCapacity(existing.count)
        var index = 0
        while index < valid.count {
            if kept.contains(index), let key = valid[index] {
                result.append(key)
                index += 1
                continue
            }
            // A run of items without a kept key, between two kept ones.
            let start = index
            while index < valid.count, !kept.contains(index) {
                index += 1
            }
            let upper = index < valid.count ? valid[index] : nil
            result += keys(count: index - start, between: result.last, and: upper)
        }
        return result
    }

    // MARK: - The arithmetic

    /// The bounds to use: invalid ones dropped, and an upper bound not above
    /// the lower one dropped.
    private static func trusted(_ a: String?, _ b: String?) -> ([Int]?, [Int]?) {
        let lower = a.flatMap { isValidKey($0) ? $0 : nil }
        var upper = b.flatMap { isValidKey($0) ? $0 : nil }
        if let lower, let bound = upper, bound <= lower { upper = nil }
        return (lower.map(digitValues), upper.map(digitValues))
    }

    private static func digitValues(_ key: String) -> [Int] {
        key.compactMap { values[$0] }
    }

    private static func string(_ digitValues: [Int]) -> String {
        String(digitValues.map { digits[$0] })
    }

    /// One step past `key`: its first digit that can go up, gone up by one.
    /// A key of nothing but the top digit gets a `1` on the end.
    private static func after(_ key: [Int]) -> [Int] {
        guard let index = key.firstIndex(where: { $0 < base - 1 }) else { return key + [1] }
        return Array(key[..<index]) + [key[index] + 1]
    }

    /// One step before `key`, which is valid and so has a digit above `0`:
    /// that first such digit gone down by one, or, when it is a `1`, a `0`
    /// followed by the top digit so the key does not end in `0`.
    private static func before(_ key: [Int]) -> [Int] {
        guard let index = key.firstIndex(where: { $0 > 0 }) else { return [base / 2] }
        let prefix = Array(key[..<index])
        return key[index] > 1 ? prefix + [key[index] - 1] : prefix + [0, base - 1]
    }

    /// The midpoint of two base-62 fractions, `a < b`, where `a` may be empty
    /// (zero) and `b` `nil` (one). Neither ends in `0`, and neither does the
    /// answer.
    private static func midpoint(_ a: [Int], _ b: [Int]?) -> [Int] {
        if let b {
            // The longest common prefix, reading a missing digit of `a` as 0.
            var shared = 0
            while shared < b.count, (shared < a.count ? a[shared] : 0) == b[shared] {
                shared += 1
            }
            if shared > 0 {
                return Array(b[..<shared]) + midpoint(Array(a.dropFirst(shared)), Array(b.dropFirst(shared)))
            }
        }
        let digitA = a.first ?? 0
        let digitB = b?.first ?? base
        if digitB - digitA > 1 {
            // Rounded up, as the reference implementation does.
            return [(digitA + digitB + 1) / 2]
        }
        // The first digits are consecutive.
        if let b, b.count > 1 {
            return [b[0]]
        }
        return [digitA] + midpoint(Array(a.dropFirst()), nil)
    }

    /// The positions ``rekey(_:)`` keeps: one longest strictly increasing run
    /// of the valid keys. The save pipeline reads which paragraphs the editor
    /// left in site from it, and which it moved.
    static func keptPositions(_ existing: [String?]) -> Set<Int> {
        longestIncreasingRun(existing.map { key in key.flatMap { isValidKey($0) ? $0 : nil } })
    }

    /// The indices of one longest strictly increasing run among the values
    /// that are not `nil`: the keys a rekey keeps, and the paragraphs a patch
    /// leaves where they are.
    static func longestIncreasingRun(_ keys: [(some Comparable)?]) -> Set<Int> {
        // `tails[length - 1]` is the index of the smallest key that ends an
        // increasing run of that length so far.
        var tails: [Int] = []
        var previous = [Int?](repeating: nil, count: keys.count)
        for (index, key) in keys.enumerated() {
            guard let key else { continue }
            var low = 0
            var high = tails.count
            while low < high {
                let middle = (low + high) / 2
                if let tail = keys[tails[middle]], tail < key { low = middle + 1 } else { high = middle }
            }
            previous[index] = low > 0 ? tails[low - 1] : nil
            if low == tails.count { tails.append(index) } else { tails[low] = index }
        }
        var kept = Set<Int>()
        var cursor = tails.last
        while let index = cursor {
            kept.insert(index)
            cursor = previous[index]
        }
        return kept
    }
}
