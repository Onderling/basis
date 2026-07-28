package org.onderling.mdns

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue

/**
 * BackoffPolicy unit tests — pure JVM, no Android deps.
 * See EXTRACTION-PLAN.md §7 Group P Tests.
 */
class BackoffPolicyTest {

    @Test
    fun `attempt 0 is 100 ms`() {
        assertEquals(100L, BackoffPolicy.delayMs(0))
    }

    @Test
    fun `attempt 1 is 200 ms`() {
        assertEquals(200L, BackoffPolicy.delayMs(1))
    }

    @Test
    fun `attempt 2 is 400 ms`() {
        assertEquals(400L, BackoffPolicy.delayMs(2))
    }

    @Test
    fun `attempt 3 is 800 ms`() {
        assertEquals(800L, BackoffPolicy.delayMs(3))
    }

    @Test
    fun `attempt 4 is 1600 ms`() {
        assertEquals(1600L, BackoffPolicy.delayMs(4))
    }

    @Test
    fun `attempts beyond the growth curve are capped at 2000 ms`() {
        assertEquals(2000L, BackoffPolicy.delayMs(5))
        assertEquals(2000L, BackoffPolicy.delayMs(6))
        assertEquals(2000L, BackoffPolicy.delayMs(10))
        assertEquals(2000L, BackoffPolicy.delayMs(30))
    }

    @Test
    fun `delay is monotonic-non-decreasing up to the cap`() {
        var prev = 0L
        for (attempt in 0..10) {
            val d = BackoffPolicy.delayMs(attempt)
            assertTrue(d >= prev, "delay should be non-decreasing but $d < $prev at attempt=$attempt")
            prev = d
        }
    }

    @Test
    fun `MAX_RETRIES is 5`() {
        assertEquals(5, BackoffPolicy.MAX_RETRIES)
    }
}
