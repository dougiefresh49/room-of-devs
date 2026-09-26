package com.dougiefresh49.roomofdevs

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

val wireJson = Json { ignoreUnknownKeys = true }

@Serializable
data class Agent(
    val sessionId: String,
    val name: String,
    val label: String = "",
    val state: String,
    val raisedAt: String? = null,
    val character: String? = null,
    val project: String? = null,
    val lastActivityAt: String? = null,
    val raisedCount: Int = 0,
) {
    val title get() = label.ifEmpty { name }
    val subtitle get() = project ?: character ?: ""
    val hasUpdate get() = state == "hand_raised"
    val badge get() = when { hasUpdate -> Badge.HAND; state == "working" -> Badge.WRENCH; else -> Badge.NONE }
}
enum class Badge { HAND, WRENCH, NONE }
/** Most recent activity first (ISO-8601 UTC strings sort chronologically); badges carry status. */
fun roomOrder(agents: List<Agent>): List<Agent> = agents.sortedWith(
    compareByDescending<Agent> { it.lastActivityAt ?: it.raisedAt ?: "" }
        .thenBy { it.title }.thenBy { it.sessionId },
)

@Serializable
data class NowPlaying(
    val sessionId: String,
    val startedAt: String,
    val text: String = "",
    val endedAt: String? = null,
    val output: String? = null,
    val replayFile: String? = null,
    val grantId: String? = null,
    val synthesisComplete: Boolean? = null,
    val kind: String? = null,
    val playbackRate: Double? = null,
)
@Serializable
data class Snapshot(val agents: List<Agent>, val nowPlaying: NowPlaying? = null, val epoch: Long? = null, val rev: Long? = null)
@Serializable
data class Replay(
    val file: String,
    val sessionId: String? = null,
    val textPreview: String? = null,
    val timestamp: String? = null,
    /** The daemon's tempo for this clip (config default_speed, per character); the mobile page's base rate. */
    val playbackRate: Double? = null,
)

/** Same epoch/revision and pre-epoch reconnect rules as room-client/store.ts. */
class SnapshotGate {
    private var epoch: Long? = null
    private var rev = Long.MIN_VALUE
    private var reconnected = true
    fun connected() { reconnected = true }
    fun accept(snapshot: Snapshot): Boolean {
        if (snapshot.epoch != null) {
            if (epoch != snapshot.epoch) { epoch = snapshot.epoch; rev = Long.MIN_VALUE }
        } else if (reconnected) rev = Long.MIN_VALUE
        reconnected = false
        snapshot.rev?.let { if (it <= rev) return false; rev = it }
        return true
    }
}

// Never stringify credentials in diagnostics, media metadata, or artwork URIs.
class Connection(val base: HttpUrl, val token: String) {
    fun url(vararg segments: String): HttpUrl = base.newBuilder().apply { segments.forEach { addPathSegment(it) } }.build()
    override fun toString() = "Room connection"
    companion object {
        fun parse(text: String): Connection {
            val url = text.trim().toHttpUrlOrNull() ?: error("Paste a complete http or https mobile URL")
            require(url.username.isEmpty() && url.password.isEmpty()) { "URL user information is not supported" }
            val token = url.queryParameter("t")?.takeIf { it.isNotBlank() && it.all { c -> c.isLetterOrDigit() || c in "_-" } }
                ?: error("The mobile URL must include its t token")
            return Connection(url.newBuilder().encodedPath("/").query(null).fragment(null).build(), token)
        }
    }
}
