package com.dougiefresh49.roomofdevs

import java.io.IOException
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy

@OptIn(ExperimentalCoroutinesApi::class)
class PlaybackTest {
    private val agent = Agent("session-123", "Thread", state = "hand_raised", raisedCount = 1)
    @Test fun duplicateTapsShareOneGrantAndStreamOnceSynthesisStarts() = runTest {
        var calls = 0
        var polls = 0
        val current = NowPlaying(agent.sessionId, "new", output = "phone", replayFile = "new.mp3", synthesisComplete = false)
        val manager = PlaybackRequests(this, {
            polls++
            Snapshot(listOf(agent), if (polls == 1) null else current)
        }, { listOf(Replay("old.mp3", agent.sessionId)) }, { calls++ })
        val first = manager.tap(agent)
        val duplicate = manager.tap(agent)
        assertSame(first, duplicate)
        val playlist = first.audio.await()
        assertEquals(listOf("new.mp3", "old.mp3"), playlist.map { it.file })
        // The granted clip streams live while still synthesizing; history plays saved files.
        assertEquals(listOf(true, false), playlist.map { it.live })
        assertEquals(1, calls)
        assertEquals(2, polls)
        // Reopening/seeking the same request cannot dispatch a second grant.
        first.audio.await()
        assertEquals(1, calls)
    }
    @Test fun retapWhileGrantedClipStillPlaysNeverGrantsAgain() = runTest {
        var calls = 0
        var now: NowPlaying? = null
        val playing = NowPlaying(agent.sessionId, "t1", output = "phone", replayFile = "new.mp3", synthesisComplete = false)
        val manager = PlaybackRequests(this, { Snapshot(listOf(agent), now) }, { emptyList() }, { calls++; now = playing },
            current = { Snapshot(listOf(agent), now) })
        val first = manager.tap(agent)
        first.audio.await()
        assertSame(first, manager.tap(agent))
        assertEquals(1, calls)
        now = playing.copy(endedAt = "t2")
        assertNotSame(first, manager.tap(agent))
    }
    @Test fun switchingThreadsKeepsTheFirstThreadsGrantGuard() = runTest {
        val other = agent.copy(sessionId = "other-session")
        val gate = CompletableDeferred<Unit>()
        var calls = 0
        val manager = PlaybackRequests(backgroundScope, { Snapshot(listOf(agent, other)) }, { emptyList() }, { calls++; gate.await() })
        val first = manager.tap(agent)
        manager.tap(other)
        runCurrent()
        assertSame(first, manager.tap(agent))
        assertEquals(2, calls)
        manager.close()
    }
    @Test fun oldPhoneFrameCannotSatisfyANewTap() = runTest {
        var calls = 0
        val old = NowPlaying(agent.sessionId, "old", output = "phone", replayFile = "old.mp3")
        val manager = PlaybackRequests(backgroundScope, { Snapshot(listOf(agent), old) }, { emptyList() }, { calls++ }, grantWaitMs = 1000)
        val request = manager.tap(agent)
        assertTrue(runCatching { request.audio.await() }.exceptionOrNull() is TimeoutCancellationException)
        assertEquals(1, calls)
    }
    @Test fun ambiguousGrantFailureIsTerminalUntilAnotherExplicitTap() = runTest {
        var calls = 0
        val manager = PlaybackRequests(backgroundScope, { Snapshot(listOf(agent)) }, { emptyList() }, { calls++; throw IOException("Disconnected") })
        val request = manager.tap(agent)
        assertTrue(runCatching { request.audio.await() }.isFailure)
        assertTrue(runCatching { request.audio.await() }.isFailure)
        assertEquals(1, calls)
        assertTrue(runCatching { manager.tap(agent).audio.await() }.isFailure)
        assertEquals(2, calls)
    }
    @Test fun idleTapUsesOnlySavedAudioAndEmptyHistoryFails() = runTest {
        var grants = 0
        val idle = agent.copy(state = "idle", raisedCount = 0)
        val manager = PlaybackRequests(backgroundScope, { Snapshot(listOf(idle)) }, { emptyList() }, { grants++ })
        assertEquals("Nothing to play yet", runCatching { manager.tap(idle).audio.await() }.exceptionOrNull()?.message)
        assertEquals(0, grants)
    }
    @Test fun queuedWorkingThreadStillReplaysLikeTheMobileCard() = runTest {
        var grants = 0
        val working = agent.copy(state = "working")
        val manager = PlaybackRequests(backgroundScope, { Snapshot(listOf(working)) }, { listOf(Replay("saved.mp3", agent.sessionId)) }, { grants++ })
        assertEquals("saved.mp3", manager.tap(working).audio.await().first().file)
        assertEquals(0, grants)
    }
    @Test fun postUsesCookieAndDoesNotRetryOrFollowRedirect() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(302).addHeader("Location", server.url("/action-again")))
            val api = RoomApi(Connection.parse(server.url("/?t=testtoken").toString()))
            assertTrue(runCatching { api.action("grant", "sessionId" to "session-123", "output" to "phone") }.isFailure)
            assertEquals(1, server.requestCount)
            val request = server.takeRequest()
            assertEquals("mobile_token=testtoken", request.getHeader("Cookie"))
            assertEquals("/action", request.path)
            assertEquals("{\"type\":\"grant\",\"sessionId\":\"session-123\",\"output\":\"phone\"}", request.body.readUtf8())
        }
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST))
            val api = RoomApi(Connection.parse(server.url("/?t=testtoken").toString()))
            assertTrue(runCatching { api.action("grant", "sessionId" to "session-123", "output" to "phone") }.isFailure)
            assertEquals(1, server.requestCount)
        }
    }
}
