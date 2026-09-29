// In the wire header, the low five bits store payload length in bytes;
// the upper three bits contain flags and must not contribute to the length.
let payloadLengthMask: UInt8 = 0x1f

func payloadLength(_ header: UInt8) -> Int {
    return Int(header & payloadLengthMask)
}
