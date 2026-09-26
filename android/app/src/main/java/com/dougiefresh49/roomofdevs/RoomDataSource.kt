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
class RoomDataSource(private val api: RoomApi, private val requests: PlaybackRequests) : DataSource {
    private val delegate = OkHttpDataSource.Factory(api.http).createDataSource()
    private var publicUri: Uri? = null
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
                    runBlocking { request.audio.await() }.first()
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
        // Live tail: the server resumes at ?from=<bytes>, so a retry after a dropped stream
        // continues where ExoPlayer stopped reading (dataSpec.position) instead of restarting.
        val live = api.connection.base.newBuilder().addPathSegment("live-audio").addPathSegment(replay.file)
            .apply { if (dataSpec.position > 0) addQueryParameter("from", dataSpec.position.toString()) }.build()
        delegate.open(dataSpec.buildUpon().setUri(live.toString()).setPosition(0).setLength(C.LENGTH_UNSET.toLong()).build())
        return C.LENGTH_UNSET.toLong()
    }
    override fun read(buffer: ByteArray, offset: Int, length: Int) = delegate.read(buffer, offset, length)
    override fun getUri() = publicUri
    override fun getResponseHeaders(): Map<String, List<String>> = emptyMap()
    override fun close() = delegate.close()
}
