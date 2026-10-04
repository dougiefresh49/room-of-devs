package com.dougiefresh49.roomofdevs

import org.junit.Assert.*
import org.junit.Test

class ProtocolTest {
    @Test fun parsesRealProtocolFixtureAndDefaultsMissingProject() {
        val fixture = requireNotNull(javaClass.classLoader?.getResource("panel-snapshot.json")).readText()
        val snapshot = wireJson.decodeFromString<Snapshot>(fixture)
        assertTrue(snapshot.agents.isNotEmpty())
        assertTrue(snapshot.agents.any { it.project == "podlink-mui-ref" })
        assertTrue(snapshot.agents.any { it.project == null })
        assertEquals("ack", snapshot.nowPlaying?.kind)
    }
    @Test fun mobileUrlSeparatesCredentialsFromOrigin() {
        val c = Connection.parse("  http://example.test:7777/app/?t=abc_123#room  ")
        assertEquals("http://example.test:7777/", c.base.toString())
        assertEquals("abc_123", c.token)
        assertFalse(c.url("replay-audio", "clip.mp3").toString().contains("abc_123"))
        assertFalse(c.toString().contains("abc_123"))
        assertEquals("https://example.test/", Connection.parse("https://example.test/?t=a").base.toString())
    }
    @Test fun rejectsMissingTokenAndUnsafeSchemes() {
        listOf("http://example.test/", "file:///tmp/key?t=abc", "https://user:pass@example.test/?t=abc", "https://example.test/?t=a%0Ab").forEach {
            assertTrue(it, runCatching { Connection.parse(it) }.isFailure)
        }
    }
    @Test fun ordersByMostRecentActivityAndMapsStatus() {
        val idle = agent("idle").copy(lastActivityAt = "2026-09-25T09:00:00Z")
        val working = agent("working").copy(lastActivityAt = "2026-09-26T05:18:00Z")
        val newer = agent("hand_raised", "2026-09-25T12:00:00Z")
        val older = agent("hand_raised", "2026-09-25T11:00:00Z").copy(lastActivityAt = "2026-09-25T11:30:00Z")
        val unknown = agent("idle", "x").copy(raisedAt = null)
        val result = roomOrder(listOf(idle, newer, unknown, working, older))
        assertEquals(listOf(working, newer, older, idle, unknown), result)
        assertTrue(newer.hasUpdate)
        assertEquals(Status.DONE, newer.status)
        assertEquals(Status.WORKING, working.status)
        assertEquals(Status.DONE, idle.status)
        assertEquals(Status.WORKING, working.copy(raisedCount = 1).status)
        assertFalse(working.copy(raisedCount = 1).hasUpdate)
        assertEquals("Thread label", idle.copy(label = "Thread label").title)
        assertEquals("Wave 3", idle.copy(label = "comic-reader-5e", threadTitle = "Wave 3").title)
        assertEquals("Raphael", idle.copy(character = "Raphael").subtitle)
        assertEquals("repo", idle.copy(project = "repo", character = "Raphael").subtitle)
    }
    @Test fun rejectsStaleAndDuplicateRevisionsAcrossReconnectButAcceptsNewEpoch() {
        val gate = SnapshotGate()
        fun s(epoch: Long?, rev: Long?) = Snapshot(emptyList(), epoch = epoch, rev = rev)
        assertTrue(gate.accept(s(10, 9)))
        assertFalse(gate.accept(s(10, 9)))
        gate.connected()
        assertFalse(gate.accept(s(10, 8)))
        assertTrue(gate.accept(s(11, 1)))
        assertTrue(gate.accept(s(11, 2)))
        gate.connected()
        assertTrue(gate.accept(s(null, 1)))
        assertFalse(gate.accept(s(null, 1)))
        gate.connected()
        assertTrue(gate.accept(s(null, 1)))
    }
    private fun agent(state: String, at: String? = null) = Agent(state + at, "name", state = state, raisedAt = at)
}
