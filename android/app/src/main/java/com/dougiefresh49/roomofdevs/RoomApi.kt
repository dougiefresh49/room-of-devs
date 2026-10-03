package com.dougiefresh49.roomofdevs

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

class RoomApi(val connection: Connection) {
    // The daemon drops idle keep-alive sockets after ~5s. Reads keep a short-lived pool
    // (evicted before the server closes) and may retry: they are idempotent and free.
    val http = OkHttpClient.Builder().retryOnConnectionFailure(true)
        .connectionPool(ConnectionPool(4, 2, TimeUnit.SECONDS))
        .followRedirects(false).followSslRedirects(false)
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS)
        .addInterceptor { chain -> chain.proceed(authorize(chain.request())) }.build()
    // POSTs (the billed grant included) never retry and never reuse a pooled socket, so a
    // stale connection can't fail them and an ambiguous failure can't send them twice.
    private val actions = http.newBuilder().retryOnConnectionFailure(false)
        .connectionPool(ConnectionPool(0, 1, TimeUnit.MILLISECONDS)).build()
    private fun authorize(request: Request): Request {
        if (request.url.scheme != connection.base.scheme || request.url.host != connection.base.host || request.url.port != connection.base.port) {
            throw IOException("Room request has a different origin")
        }
        return request.newBuilder().header("Cookie", "mobile_token=${connection.token}").build()
    }
    fun request(vararg path: String) = Request.Builder().url(connection.url(*path)).build()
    private suspend fun execute(request: Request, client: OkHttpClient = http): String = withContext(Dispatchers.IO) {
        client.newCall(request).execute().use {
            if (!it.isSuccessful) throw IOException("Room request failed (${it.code})")
            it.body?.string() ?: throw IOException("Room returned an empty response")
        }
    }
    suspend fun snapshot() = wireJson.decodeFromString<Snapshot>(execute(request("snapshot")))
    suspend fun replays(sessionId: String) = wireJson.decodeFromString<List<Replay>>(execute(request("replay-list")))
        .filter { it.sessionId == sessionId && safeReplay(it.file) }.sortedByDescending { it.file }
    suspend fun projectVoices() = wireJson.decodeFromString<ProjectVoicesPayload>(execute(request("project-voices"))).usable()
    /** Saves one project's voice; an empty [voiceId] clears it back to the room default. */
    suspend fun setProjectVoice(project: String, voiceId: String) =
        action("set_project_voice", "project" to project, "voiceId" to voiceId)
    suspend fun action(type: String, vararg fields: Pair<String, String>) {
        val body = buildJsonObject { put("type", type); fields.forEach { (k, v) -> put(k, v) } }
        val result = execute(Request.Builder().url(connection.url("action"))
            .post(body.toString().toRequestBody("application/json".toMediaType())).build(), actions)
        if (wireJson.parseToJsonElement(result).jsonObject["ok"]?.jsonPrimitive?.booleanOrNull != true) {
            throw IOException("Room rejected the action")
        }
    }
}
fun safeReplay(file: String) = file.endsWith(".mp3") && file.none { it == '/' || it == '\\' || it == '\u0000' } && !file.contains("..")
