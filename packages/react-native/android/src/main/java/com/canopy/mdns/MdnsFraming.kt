package org.onderling.mdns

import java.nio.ByteBuffer

/**
 * TCP framing: 4-byte big-endian length prefix + payload.
 *
 * Extracted so the protocol can be unit-tested without Android deps.
 * The read side is handled by DataInputStream.readInt() + readFully() in
 * MdnsModule, which is the natural inverse of encode() below.
 */
object MdnsFraming {

    const val MAX_PAYLOAD = 4_194_304  // 4 MB sanity cap

    /** Prepend a 4-byte big-endian length to [payload] and return the frame. */
    fun encode(payload: ByteArray): ByteArray =
        ByteBuffer.allocate(4 + payload.size)
            .putInt(payload.size)
            .put(payload)
            .array()
}
