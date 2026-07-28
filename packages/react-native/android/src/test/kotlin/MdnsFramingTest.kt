package org.onderling.mdns

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertArrayEquals
import java.nio.ByteBuffer

/**
 * MdnsFraming unit tests — pure JVM, no Android deps.
 * See EXTRACTION-PLAN.md §7 Group P Tests.
 */
class MdnsFramingTest {

    @Test
    fun `encode prepends 4-byte big-endian length`() {
        val payload = byteArrayOf(1, 2, 3, 4, 5)
        val frame   = MdnsFraming.encode(payload)

        // Frame: [0,0,0,5, 1,2,3,4,5]
        assertEquals(4 + payload.size, frame.size)
        assertEquals(0, frame[0])
        assertEquals(0, frame[1])
        assertEquals(0, frame[2])
        assertEquals(5, frame[3])
        assertArrayEquals(payload, frame.copyOfRange(4, frame.size))
    }

    @Test
    fun `encode handles empty payload`() {
        val frame = MdnsFraming.encode(ByteArray(0))
        assertEquals(4, frame.size)
        assertArrayEquals(byteArrayOf(0, 0, 0, 0), frame)
    }

    @Test
    fun `encode length prefix is decodable as big-endian int`() {
        val payload = ByteArray(1024) { it.toByte() }
        val frame   = MdnsFraming.encode(payload)
        val decodedLength = ByteBuffer.wrap(frame, 0, 4).int
        assertEquals(payload.size, decodedLength)
    }

    @Test
    fun `encode then decode round-trip preserves payload`() {
        val payload = "hello, mesh".toByteArray(Charsets.UTF_8)
        val frame   = MdnsFraming.encode(payload)

        // Manually decode like DataInputStream.readInt + readFully would
        val len = ByteBuffer.wrap(frame, 0, 4).int
        val body = frame.copyOfRange(4, 4 + len)
        assertEquals(payload.size, len)
        assertArrayEquals(payload, body)
    }

    @Test
    fun `MAX_PAYLOAD is 4 MB`() {
        assertEquals(4_194_304, MdnsFraming.MAX_PAYLOAD)
    }

    @Test
    fun `encode works near boundary below MAX_PAYLOAD`() {
        val payload = ByteArray(1024) { (it % 256).toByte() }
        val frame   = MdnsFraming.encode(payload)
        val len     = ByteBuffer.wrap(frame, 0, 4).int
        assertEquals(1024, len)
        assertArrayEquals(payload, frame.copyOfRange(4, 4 + len))
    }
}
