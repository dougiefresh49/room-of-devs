package com.dougiefresh49.roomofdevs

import android.net.Uri
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.*
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.common.C
import java.io.IOException
import kotlinx.coroutines.runBlocking

/** A playback failure no network retry can fix (bad tap, nothing to play). */
class TerminalRoomException(message: String) : IOException(message)

/** Public media URIs contain opaque request IDs or replay basenames, never credentials. */
@UnstableApi
class RoomDataSource(
    private val api: RoomApi,
    private val requests: PlaybackRequests,
    private val reconnectDelayMs: Long = 1_000,
    /** A granted clip finished synthesizing before this open and is served whole. */
    private val onFinalized: (String) -> Unit = {},
) : DataSource {
    private val delegate = OkHttpDataSource.Factory(api.http).createDataSource()
    private var publicUri: Uri? = null
    private var tail: LiveTail? = null
    override fun addTransferListener(listener: TransferListener) = delegate.addTransferListener(listener)
    override fun open(dataSpec: DataSpec): Long {
        publicUri = dataSpec.uri
        val uri = dataSpec.uri
        val replay = try {
            when {
                uri.scheme != "room" -> throw IOException("Unsupported media URI")
                uri.host == "replay" -> Replay(uri.lastPathSegment ?: throw IOException("Missing replay"))
                uri.host == "request" -> {
                    val request = requests.requests[uri.lastPathSegment] ?: throw IOException("Tap the thread again")
                    val first = runBlocking { request.audio.await() }.first()
                    // Once a clip is known whole, later opens (seeks, resumes) skip the lookup.
                    if (first.live && first.file in requests.finalized) first.copy(live = false)
                    else runBlocking { wholeOnceFinalized(first, request.agent.sessionId, api::replays) }
                        .also { if (first.live && !it.live) { requests.finalized.add(it.file); onFinalized(it.file) } }
                }
                else -> throw IOException("Unsupported media URI")
            }
        } catch (e: Exception) {
            // Do not expose a network exception's host or request details to controllers.
            throw TerminalRoomException(if (e.message == "Nothing to play yet") e.message!! else "Update unavailable; tap the thread again")
        }
        if (!safeReplay(replay.file)) throw TerminalRoomException("Invalid replay")
        if (!replay.live) {
            return delegate.open(dataSpec.buildUpon().setUri(api.connection.url("replay-audio", replay.file).toString()).build())
        }
        // ExoPlayer restarts an unknown-length, unseekable stream from byte 0 on retry, so
        // reconnects happen here instead: resume at ?from=<bytes delivered>, bounded.
        val live = LiveTail(
            openAt = { from ->
                val url = api.connection.base.newBuilder().addPathSegment("live-audio").addPathSegment(replay.file)
                    .apply { if (from > 0) addQueryParameter("from", from.toString()) }.build()
                delegate.open(dataSpec.buildUpon().setUri(url.toString()).setPosition(0).setLength(C.LENGTH_UNSET.toLong()).build())
            },
            readChunk = delegate::read,
            closeStream = delegate::close,
            delayMs = reconnectDelayMs,
        )
        tail = live
        live.start(dataSpec.position)
        return C.LENGTH_UNSET.toLong()
    }
    override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
        tail?.read(buffer, offset, length) ?: delegate.read(buffer, offset, length)
    override fun getUri() = publicUri
    override fun getResponseHeaders(): Map<String, List<String>> = emptyMap()
    override fun close() { tail = null; delegate.close() }
}

/**
 * A granted clip streams live while it synthesizes. Once /replay-list shows it (the list skips
 * .part files) a reopen serves the whole file instead: known length, so the car shows a duration
 * and can seek. A failed check keeps the live tail, which serves a finished file too.
 */
suspend fun wholeOnceFinalized(clip: Replay, sessionId: String, replays: suspend (String) -> List<Replay>): Replay {
    if (!clip.live) return clip
    val listed = runCatching { replays(sessionId) }.getOrNull()?.any { it.file == clip.file } == true
    return if (listed) clip.copy(live = false) else clip
}

/**
 * Bounded reconnect loop for the /live-audio tail, which resumes at a byte offset.
 * Gives up after [maxFailures] consecutive failures without progress (terminal: no ExoPlayer retry).
 */
class LiveTail(
    private val openAt: (from: Long) -> Unit,
    private val readChunk: (ByteArray, Int, Int) -> Int,
    private val closeStream: () -> Unit,
    private val maxFailures: Int = 5,
    private val delayMs: Long = 1_000,
) {
    var offset = 0L
        private set
    fun start(from: Long) { offset = from; attempt(openFirst = true) { 0 } }
    fun read(buffer: ByteArray, off: Int, length: Int): Int =
        attempt(openFirst = false) { readChunk(buffer, off, length) }.also { if (it > 0) offset += it }
    private fun attempt(openFirst: Boolean, block: () -> Int): Int {
        var failures = 0
        var needsOpen = openFirst
        while (true) {
            try {
                if (needsOpen) { openAt(offset); needsOpen = false }
                return block()
            } catch (e: IOException) {
                if (e is TerminalRoomException) throw e
                if (++failures > maxFailures) throw TerminalRoomException("Update unavailable; tap the thread again")
                runCatching { closeStream() }
                if (delayMs > 0) Thread.sleep(delayMs)
                needsOpen = true
            }
        }
    }
}
