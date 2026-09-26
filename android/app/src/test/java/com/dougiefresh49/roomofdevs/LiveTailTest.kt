package com.dougiefresh49.roomofdevs

import java.io.IOException
import org.junit.Assert.*
import org.junit.Test

class LiveTailTest {
    /** A growing file served from an offset; drops the connection at the given byte positions. */
    private class FakeServer(val data: ByteArray, dropsAt: List<Int>, val refuseOpens: Int = 0) {
        val drops = dropsAt.toMutableList()
        val opens = mutableListOf<Long>()
        var pos = 0
        var open = false
        var refused = 0
        fun openAt(from: Long) {
            if (refused < refuseOpens) { refused++; throw IOException("refused") }
            opens += from; pos = from.toInt(); open = true
        }
        fun read(buf: ByteArray, off: Int, len: Int): Int {
            check(open)
            if (drops.firstOrNull() == pos) { drops.removeAt(0); open = false; throw IOException("reset") }
            if (pos >= data.size) return -1
            val n = minOf(len, 3, data.size - pos, (drops.firstOrNull() ?: Int.MAX_VALUE) - pos)
            System.arraycopy(data, pos, buf, off, n); pos += n; return n
        }
    }
    private fun drain(tail: LiveTail): ByteArray {
        val out = java.io.ByteArrayOutputStream(); val buf = ByteArray(8)
        while (true) { val n = tail.read(buf, 0, buf.size); if (n < 0) break; out.write(buf, 0, n) }
        return out.toByteArray()
    }
    @Test fun dropsResumeAtBytesDeliveredWithoutGapsOrRepeats() {
        val data = ByteArray(40) { it.toByte() }
        val server = FakeServer(data, dropsAt = listOf(7, 22))
        val tail = LiveTail(server::openAt, server::read, { server.open = false }, delayMs = 0)
        tail.start(0)
        assertArrayEquals(data, drain(tail))
        assertEquals(listOf(0L, 7L, 22L), server.opens)
    }
    @Test fun startsFromExoPlayersRequestedPosition() {
        val server = FakeServer(ByteArray(10) { it.toByte() }, dropsAt = emptyList())
        val tail = LiveTail(server::openAt, server::read, {}, delayMs = 0)
        tail.start(4)
        assertArrayEquals(ByteArray(6) { (it + 4).toByte() }, drain(tail))
    }
    @Test fun failedReopensCountAndGiveUpTerminallyAfterTheCap() {
        val server = FakeServer(ByteArray(10), dropsAt = emptyList(), refuseOpens = 99)
        val tail = LiveTail(server::openAt, server::read, {}, maxFailures = 5, delayMs = 0)
        val error = runCatching { tail.start(0) }.exceptionOrNull()
        assertTrue(error is TerminalRoomException)
        assertEquals(6, server.refused)
    }
    @Test fun recoversWhenTheDaemonComesBackWithinTheCap() {
        val data = ByteArray(12) { it.toByte() }
        val server = FakeServer(data, dropsAt = listOf(5), refuseOpens = 0)
        var refuseNext = 3
        val tail = LiveTail({ from -> if (from > 0 && refuseNext-- > 0) throw IOException("down"); server.openAt(from) },
            server::read, {}, maxFailures = 5, delayMs = 0)
        tail.start(0)
        assertArrayEquals(data, drain(tail))
    }
}
