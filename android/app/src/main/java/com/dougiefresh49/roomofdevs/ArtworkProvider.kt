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

/**
 * One cached PNG per character. The URI is keyed on the character alone, so the host's
 * per-URI artwork cache never goes stale: status lives in text, not in the picture.
 */
class ArtworkCache(private val context: Context, private val api: RoomApi) {
    suspend fun uri(character: String?, initials: String): Uri = withContext(Dispatchers.IO) {
        val name = character?.takeIf { it.isNotBlank() }?.lowercase() ?: "default"
        val key = MessageDigest.getInstance("SHA-256")
            .digest("${api.connection.base}|$name".toByteArray())
            .joinToString("") { "%02x".format(it) }
        val dir = File(context.cacheDir, "artwork").apply { mkdirs() }
        val file = File(dir, "$key.png")
        if (!file.exists() || System.currentTimeMillis() - file.lastModified() > 3_600_000) {
            val bitmap = Bitmap.createBitmap(256, 256, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            canvas.drawColor(Color.rgb(34, 38, 42))
            fun fetch(avatar: String): Bitmap? = runCatching {
                api.http.newCall(api.request("avatars", "tmnt", avatar, "idle.png")).execute().use {
                    if (it.isSuccessful) it.body?.byteStream()?.use(BitmapFactory::decodeStream) else null
                }
            }.getOrNull()
            val source = fetch(name) ?: if (name != "default") fetch("default") else null
            if (source != null) {
                canvas.drawBitmap(source, null, Rect(0, 0, 256, 256), Paint(Paint.FILTER_BITMAP_FLAG))
                source.recycle()
            } else {
                canvas.drawText(initials.take(2).uppercase(), 40f, 150f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    color = Color.LTGRAY; textSize = 80f
                })
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
