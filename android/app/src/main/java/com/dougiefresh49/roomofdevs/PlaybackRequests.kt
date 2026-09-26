package com.dougiefresh49.roomofdevs

import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.*

class PlaybackRequest(val id: String, val agent: Agent, val audio: Deferred<List<Replay>>)

/** A tap creates one immutable result. ExoPlayer reopens only that result, never a grant. */
class PlaybackRequests(
    private val scope: CoroutineScope,
    private val snapshot: suspend () -> Snapshot,
    private val replays: suspend (String) -> List<Replay>,
    private val grant: suspend (String) -> Unit,
    private val pollMs: Long = 500,
    private val grantWaitMs: Long = 25_000,
    private val pollSnapshot: suspend () -> Snapshot = snapshot,
    /** Latest snapshot without I/O (the SSE value), for the re-tap guard. */
    private val current: () -> Snapshot? = { null },
) {
    val requests = ConcurrentHashMap<String, PlaybackRequest>()
    private val pending = mutableMapOf<String, PlaybackRequest>()
    private val history = ArrayDeque<String>()

    // Called on the service main thread. Store the guard before the coroutine can dispatch.
    @OptIn(ExperimentalCoroutinesApi::class)
    fun tap(agent: Agent): PlaybackRequest {
        pending[agent.sessionId]?.let { previous ->
            if (previous.audio.isActive) return previous
            // A granted clip streams before synthesis ends, so the request completes early.
            // While that clip is still the phone's now-playing, a re-tap replays it, never re-grants.
            val first = runCatching { previous.audio.getCompleted().firstOrNull() }.getOrNull()
            val np = current()?.nowPlaying
            if (first?.live == true && np?.replayFile == first.file && np.endedAt == null) return previous
        }
        val id = UUID.randomUUID().toString()
        val audio = CompletableDeferred<List<Replay>>()
        val job = scope.launch(start = CoroutineStart.LAZY) {
            try { audio.complete(resolve(agent)) }
            catch (e: CancellationException) { audio.cancel(e) }
            catch (e: Exception) { audio.completeExceptionally(e) }
        }
        audio.invokeOnCompletion { if (audio.isCancelled) job.cancel() }
        val request = PlaybackRequest(id, agent, audio)
        // Keep bounded results for current-player reopen/seek, including terminal failures.
        while (history.size >= 32) {
            val oldest = history.first()
            val old = requests[oldest]
            if (old?.audio?.isActive == true) break
            history.removeFirst()
            requests.remove(oldest)
            if (old != null && pending[old.agent.sessionId]?.id == oldest) pending.remove(old.agent.sessionId)
        }
        history.addLast(id)
        requests[id] = request
        pending[agent.sessionId] = request
        job.start()
        return request
    }
    fun close() { requests.values.forEach { it.audio.cancel() }; requests.clear(); pending.clear(); history.clear() }

    private suspend fun resolve(selected: Agent): List<Replay> {
        val before = snapshot()
        val agent = before.agents.find { it.sessionId == selected.sessionId }
            ?: throw IOException("Thread is no longer in the room")
        if (!agent.hasUpdate) return replays(agent.sessionId).ifEmpty { throw IOException("Nothing to play yet") }
        val baseline = before.nowPlaying
        grant(agent.sessionId) // exactly one attempt; errors are terminal for this tap
        val started = withTimeout(grantWaitMs) {
            var frame: NowPlaying?
            do {
                delay(pollMs)
                frame = pollSnapshot().nowPlaying?.takeIf {
                    it.sessionId == agent.sessionId && it.output == "phone" && it.endedAt == null &&
                        it.kind != "ack" && it.replayFile != null && safeReplay(it.replayFile) &&
                        (it.replayFile != baseline?.replayFile || it.startedAt != baseline.startedAt)
                }
            } while (frame == null)
            frame
        }
        // Play as soon as synthesis starts: /live-audio tails the growing .part and serves
        // the finalized file the same way, so the granted clip always streams from there.
        val file = requireNotNull(started.replayFile)
        val saved = replays(agent.sessionId)
        val current = (saved.find { it.file == file } ?: Replay(file, agent.sessionId, started.text, playbackRate = started.playbackRate))
            .copy(live = true)
        return listOf(current) + saved.filter { it.file != file }
    }
}
