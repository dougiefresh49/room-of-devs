package com.dougiefresh49.roomofdevs

import android.content.*
import android.database.Cursor
import android.graphics.*
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.File
import java.io.FileNotFoundException
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class ArtworkCache(private val context: Context, private val api: RoomApi) {
    suspend fun uri(agent: Agent): Uri = withContext(Dispatchers.IO) {
        val character = agent.character?.lowercase() ?: "default"
        val key = MessageDigest.getInstance("SHA-256")
            .digest("${api.connection.base}|$character|${agent.badge}".toByteArray())
            .joinToString("") { "%02x".format(it) }
        val dir = File(context.cacheDir, "artwork").apply { mkdirs() }
        val file = File(dir, "$key.png")
        if (!file.exists() || System.currentTimeMillis() - file.lastModified() > 3_600_000) {
            val bitmap = Bitmap.createBitmap(256, 256, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            canvas.drawColor(Color.rgb(34, 38, 42))
            fun fetch(name: String): Bitmap? = runCatching {
                api.http.newCall(api.request("avatars", "tmnt", name, "idle.png")).execute().use {
                    if (it.isSuccessful) it.body?.byteStream()?.use(BitmapFactory::decodeStream) else null
                }
            }.getOrNull()
            val source = fetch(character) ?: if (character != "default") fetch("default") else null
            if (source != null) {
                canvas.drawBitmap(source, null, Rect(0, 0, 256, 256), Paint(Paint.FILTER_BITMAP_FLAG))
                source.recycle()
            } else {
                canvas.drawText(agent.title.take(2).uppercase(), 40f, 150f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    color = Color.LTGRAY; textSize = 80f
                })
            }
            if (agent.badge != Badge.NONE) {
                canvas.drawCircle(216f, 216f, 40f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(20, 23, 26) })
                context.getDrawable(if (agent.badge == Badge.HAND) R.drawable.ic_hand else R.drawable.ic_wrench)?.apply {
                    setBounds(190, 190, 242, 242); draw(canvas)
                }
            }
            val temp = File.createTempFile("art", ".tmp", dir)
            temp.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            if (!temp.renameTo(file)) temp.delete()
            bitmap.recycle()
            dir.listFiles()?.filter { it.extension == "png" }?.sortedByDescending { it.lastModified() }
                ?.drop(100)?.forEach { it.delete() }
        }
        Uri.parse("content://${context.packageName}.artwork/$key.png")
    }
}

/** Exposes only generated PNGs, never network URLs, preferences, or arbitrary paths. */
class ArtworkProvider : ContentProvider() {
    override fun onCreate() = true
    override fun getType(uri: Uri) = "image/png"
    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        val name = uri.lastPathSegment ?: throw FileNotFoundException()
        if (mode != "r" || uri.pathSegments.size != 1 || !Regex("[a-f0-9]{64}\\.png").matches(name)) throw FileNotFoundException()
        val file = File(requireNotNull(context).cacheDir, "artwork/$name")
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }
    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = throw UnsupportedOperationException()
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
}
