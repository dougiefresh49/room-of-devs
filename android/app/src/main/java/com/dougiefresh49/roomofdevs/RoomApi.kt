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
    // POSTs must never retry, including ambiguous socket failures or redirects.
    val http = OkHttpClient.Builder().retryOnConnectionFailure(false)
        .followRedirects(false).followSslRedirects(false)
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            val request = chain.request()
            if (request.url.scheme != connection.base.scheme || request.url.host != connection.base.host || request.url.port != connection.base.port) {
                throw IOException("Room request has a different origin")
            }
            chain.proceed(request.newBuilder().header("Cookie", "mobile_token=${connection.token}").build())
        }.build()
    fun request(vararg path: String) = Request.Builder().url(connection.url(*path)).build()
    private suspend fun execute(request: Request): String = withContext(Dispatchers.IO) {
        http.newCall(request).execute().use {
            if (!it.isSuccessful) throw IOException("Room request failed (${it.code})")
            it.body?.string() ?: throw IOException("Room returned an empty response")
        }
    }
    suspend fun snapshot() = wireJson.decodeFromString<Snapshot>(execute(request("snapshot")))
    suspend fun replays(sessionId: String) = wireJson.decodeFromString<List<Replay>>(execute(request("replay-list")))
        .filter { it.sessionId == sessionId && safeReplay(it.file) }.sortedByDescending { it.file }
    suspend fun action(type: String, vararg fields: Pair<String, String>) {
        val body = buildJsonObject { put("type", type); fields.forEach { (k, v) -> put(k, v) } }
        val result = execute(Request.Builder().url(connection.url("action"))
            .post(body.toString().toRequestBody("application/json".toMediaType())).build())
        if (wireJson.parseToJsonElement(result).jsonObject["ok"]?.jsonPrimitive?.booleanOrNull != true) {
            throw IOException("Room rejected the action")
        }
    }
}
fun safeReplay(file: String) = file.endsWith(".mp3") && file.none { it == '/' || it == '\\' || it == '\u0000' } && !file.contains("..")
