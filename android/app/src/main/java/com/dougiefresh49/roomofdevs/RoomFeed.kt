package com.dougiefresh49.roomofdevs

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import okhttp3.Response
import okhttp3.sse.*

/** One connection per service, retained only while at least one controller exists. */
class RoomFeed(private val api: RoomApi, private val scope: CoroutineScope) {
    val snapshots = MutableStateFlow<Snapshot?>(null)
    private val gate = SnapshotGate()
    private val streamHttp = api.http.newBuilder().readTimeout(0, java.util.concurrent.TimeUnit.MILLISECONDS).build()
    private var source: EventSource? = null
    private var retry: Job? = null
    private var active = false
    private var streamOpen = false
    private var generation = 0
    private var backoff = 500L
    fun accept(snapshot: Snapshot) { if (gate.accept(snapshot)) snapshots.value = snapshot }
    suspend fun refresh(): Snapshot { val next = api.snapshot(); accept(next); return snapshots.value ?: next }
    suspend fun currentOrRefresh(): Snapshot = if (streamOpen) snapshots.value ?: refresh() else refresh()
    fun start() { if (!active) { active = true; connect() } }
    fun stop() { active = false; streamOpen = false; generation++; retry?.cancel(); source?.cancel(); source = null }
    private fun connect() {
        if (!active) return
        streamOpen = false
        val attempt = ++generation
        source = EventSources.createFactory(streamHttp).newEventSource(api.request("events"), object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: Response) {
                scope.launch { if (attempt == generation) { gate.connected(); backoff = 500; streamOpen = true } }
            }
            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                scope.launch {
                    if (attempt != generation) return@launch
                    // /events emits raw snapshots, interspersed with notices.
                    runCatching { wireJson.decodeFromString<Snapshot>(data) }.getOrNull()?.let(::accept)
                }
            }
            override fun onClosed(eventSource: EventSource) = reconnect(attempt)
            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) = reconnect(attempt)
        })
    }
    private fun reconnect(attempt: Int) {
        scope.launch {
            if (!active || generation != attempt || retry?.isActive == true) return@launch
            streamOpen = false
            source?.cancel(); source = null
            retry = scope.launch {
                delay(backoff + kotlin.random.Random.nextLong(500))
                backoff = (backoff * 1.5).toLong().coerceAtMost(10_000)
                retry = null
                connect()
            }
        }
    }
}
