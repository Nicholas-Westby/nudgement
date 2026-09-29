func payloadLength(_ header: UInt8) -> Int {
    return Int(header & 0x1f)
}
