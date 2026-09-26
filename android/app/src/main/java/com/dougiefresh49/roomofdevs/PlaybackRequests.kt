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
    private val completeWaitMs: Long = 120_000,
    private val pollSnapshot: suspend () -> Snapshot = snapshot,
) {
    val requests = ConcurrentHashMap<String, PlaybackRequest>()
    private val pending = mutableMapOf<String, PlaybackRequest>()
    private val history = ArrayDeque<String>()

    // Called on the service main thread. Store the guard before the coroutine can dispatch.
    fun tap(agent: Agent): PlaybackRequest {
        pending[agent.sessionId]?.takeIf { it.audio.isActive }?.let { return it }
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
        // Replay endpoint serves finalized files only. Do not consume a growing .part as MP3.
        val file = requireNotNull(started.replayFile)
        withTimeout(completeWaitMs) {
            var frame = started
            while (frame.synthesisComplete == false) {
                delay(pollMs)
                val next = pollSnapshot().nowPlaying
                if (next?.replayFile == file) frame = next
                else if (replays(agent.sessionId).any { it.file == file }) break
                else throw IOException("Update was interrupted; tap again")
            }
        }
        val saved = replays(agent.sessionId)
        val current = saved.find { it.file == file } ?: Replay(file, agent.sessionId, started.text)
        return listOf(current) + saved.filter { it.file != file }
    }
}
