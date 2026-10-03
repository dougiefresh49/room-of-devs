package com.dougiefresh49.roomofdevs

import java.io.IOException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class ResumeAndSpeedTest {
    private val live = Replay("new.mp3", "session-123", live = true)

    @Test fun finishedGrantReopensWhole() = runTest {
        val whole = wholeOnceFinalized(live, "session-123") { listOf(Replay("new.mp3", it), Replay("old.mp3", it)) }
        assertFalse(whole.live)
        assertEquals("new.mp3", whole.file)
    }
    @Test fun stillSynthesizingStaysLive() = runTest {
        assertTrue(wholeOnceFinalized(live, "session-123") { listOf(Replay("old.mp3", it)) }.live)
    }
    @Test fun failedCheckStaysLive() = runTest {
        assertTrue(wholeOnceFinalized(live, "session-123") { throw IOException("offline") }.live)
    }
    @Test fun savedClipNeverAsks() = runTest {
        val saved = Replay("old.mp3", "session-123")
        assertSame(saved, wholeOnceFinalized(saved, "session-123") { error("no lookup for a saved clip") })
    }
    @Test fun settingIsTheSpeedHeardNotAMultiplierOnTheDaemonTempo() {
        // config default_speed 1.5 used to make "1x" play at 1.5x.
        assertEquals(1.0f, carPlaybackRate(1.0, 1.5, live = false, slower = false), 0.001f)
        assertEquals(1.75f, carPlaybackRate(1.75, 1.5, live = false, slower = false), 0.001f)
        assertEquals(0.85f, carPlaybackRate(1.0, 1.5, live = false, slower = true), 0.001f)
    }
    @Test fun liveTailHonorsSlowerSettingsButNeverOutrunsTheClipTempo() {
        assertEquals(1.0f, carPlaybackRate(1.0, 1.5, live = true, slower = false), 0.001f)
        assertEquals(1.5f, carPlaybackRate(2.0, 1.5, live = true, slower = false), 0.001f)
        assertEquals(1.0f, carPlaybackRate(1.25, 0.9, live = true, slower = false), 0.001f)
    }
}
