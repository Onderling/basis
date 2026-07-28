package org.onderling.mdns

/**
 * Exponential backoff for NsdManager resolve retries.
 *
 * Extracted so the delay formula can be unit-tested without Android deps.
 * Android < 12 allows only one concurrent resolveService() call; when it
 * returns FAILURE_ALREADY_ACTIVE we retry up to MAX_RETRIES times.
 */
object BackoffPolicy {

    const val MAX_RETRIES = 5

    /**
     * Returns the delay in milliseconds before attempt [attempt] (0-based).
     *
     * attempt 0 →  100 ms
     * attempt 1 →  200 ms
     * attempt 2 →  400 ms
     * attempt 3 →  800 ms
     * attempt 4 → 1600 ms
     * attempt 5+→ 2000 ms (capped)
     */
    fun delayMs(attempt: Int): Long = (100L * (1L shl attempt)).coerceAtMost(2000L)
}
