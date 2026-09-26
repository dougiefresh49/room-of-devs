package com.dougiefresh49.roomofdevs

import android.net.Uri
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.*
import androidx.media3.datasource.okhttp.OkHttpDataSource
import java.io.IOException
import kotlinx.coroutines.runBlocking

/** Public media URIs contain opaque request IDs or replay basenames, never credentials. */
@UnstableApi
class RoomDataSource(private val api: RoomApi, private val requests: PlaybackRequests) : DataSource {
    private val delegate = OkHttpDataSource.Factory(api.http).createDataSource()
    private var publicUri: Uri? = null
    override fun addTransferListener(listener: TransferListener) = delegate.addTransferListener(listener)
    override fun open(dataSpec: DataSpec): Long {
        publicUri = dataSpec.uri
        val uri = dataSpec.uri
        val file = try {
            when {
                uri.scheme != "room" -> throw IOException("Unsupported media URI")
                uri.host == "replay" -> uri.lastPathSegment ?: throw IOException("Missing replay")
                uri.host == "request" -> {
                    val request = requests.requests[uri.lastPathSegment] ?: throw IOException("Tap the thread again")
                    runBlocking { request.audio.await() }.first().file
                }
                else -> throw IOException("Unsupported media URI")
            }
        } catch (e: Exception) {
            // Do not expose a network exception's host or request details to controllers.
            throw IOException(if (e.message == "Nothing to play yet") e.message else "Update unavailable; tap the thread again")
        }
        if (!safeReplay(file)) throw IOException("Invalid replay")
        return delegate.open(dataSpec.buildUpon().setUri(api.connection.url("replay-audio", file).toString()).build())
    }
    override fun read(buffer: ByteArray, offset: Int, length: Int) = delegate.read(buffer, offset, length)
    override fun getUri() = publicUri
    override fun getResponseHeaders(): Map<String, List<String>> = emptyMap()
    override fun close() = delegate.close()
}
