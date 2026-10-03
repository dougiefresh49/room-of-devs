package com.dougiefresh49.roomofdevs

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewOutlineProvider
import android.view.WindowInsets
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable

/** `GET /project-voices`: projects in the daemon's order (most recently active first). */
@Serializable
data class ProjectVoicesPayload(
    val projects: List<ProjectVoice> = emptyList(),
    val characters: List<VoiceCharacter> = emptyList(),
)

@Serializable
data class ProjectVoice(
    val name: String = "",
    val dir: String? = null,
    val lastActivityAt: String? = null,
    val voiceId: String? = null,
    val character: String? = null,
) {
    /** Second line of the project row. A voice the room no longer lists still reads as set. */
    val voiceLabel get() = character?.takeIf { it.isNotBlank() }
        ?: if (voiceId.isNullOrBlank()) "Default" else "Custom voice"
}

@Serializable
data class VoiceCharacter(val voiceId: String = "", val name: String = "")

/** Rows worth showing: the daemon may add entries this build can't act on. */
fun ProjectVoicesPayload.usable() = copy(
    projects = projects.filter { it.name.isNotBlank() },
    characters = characters.filter { it.voiceId.isNotBlank() && it.name.isNotBlank() },
)

/** Character idle frames for list rows, fetched once per process per character. */
object AvatarImages {
    private val cache = mutableMapOf<String, Bitmap>()

    /** Same path as ArtworkCache and the mobile SPA. Null on any failure (caller shows a letter). */
    suspend fun load(api: RoomApi, character: String): Bitmap? {
        val key = character.lowercase()
        synchronized(cache) { cache[key] }?.let { return it }
        val bitmap = withContext(Dispatchers.IO) {
            runCatching {
                api.http.newCall(api.request("avatars", "tmnt", key, "idle.png")).execute().use {
                    if (it.isSuccessful) it.body?.byteStream()?.use(BitmapFactory::decodeStream) else null
                }
            }.getOrNull()
        } ?: return null
        synchronized(cache) { cache[key] = bitmap }
        return bitmap
    }

    /** A ~40dp circle: the character's initial until (and unless) the image arrives. */
    fun view(context: Context, scope: CoroutineScope, api: RoomApi, character: String, letter: String): FrameLayout {
        val size = (40 * context.resources.displayMetrics.density).toInt()
        val frame = FrameLayout(context).apply {
            layoutParams = LinearLayout.LayoutParams(size, size)
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.rgb(34, 38, 42)) }
            outlineProvider = ViewOutlineProvider.BACKGROUND
            clipToOutline = true
        }
        val initial = TextView(context).apply { text = letter; textSize = 18f; gravity = Gravity.CENTER }
        val image = ImageView(context).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
        frame.addView(initial, FrameLayout.LayoutParams(size, size))
        frame.addView(image, FrameLayout.LayoutParams(size, size))
        scope.launch {
            load(api, character)?.let { image.setImageBitmap(it); initial.text = "" }
        }
        return frame
    }
}

/** The setup screen's padded, inset-aware column, inside a ScrollView so long lists scroll. */
fun scrollingColumn(context: Context): Pair<ScrollView, LinearLayout> {
    val column = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(32, 32, 32, 32)
        setOnApplyWindowInsetsListener { view, insets ->
            val bars = insets.getInsets(WindowInsets.Type.systemBars())
            view.setPadding(32 + bars.left, 32 + bars.top, 32 + bars.right, 32 + bars.bottom)
            insets
        }
    }
    return ScrollView(context).apply { addView(column) } to column
}

/** One tappable list row shared by the project list and the character picker. */
fun voiceRow(context: Context, title: String, subtitle: String?, start: View?, endIcon: Int?, onClick: () -> Unit): LinearLayout {
    val attrs = context.obtainStyledAttributes(intArrayOf(android.R.attr.selectableItemBackground, android.R.attr.textColorSecondary))
    val ripple = attrs.getDrawable(0)
    val secondary = attrs.getColorStateList(1)
    attrs.recycle()
    return LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(0, 24, 0, 24)
        background = ripple
        setOnClickListener { onClick() }
        start?.let {
            addView(it)
            (it.layoutParams as LinearLayout.LayoutParams).marginEnd = (16 * context.resources.displayMetrics.density).toInt()
        }
        addView(LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            addView(TextView(context).apply { text = title; textSize = 18f })
            subtitle?.let { addView(TextView(context).apply { text = it; secondary?.let(::setTextColor) }) }
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        endIcon?.let { addView(ImageView(context).apply { setImageResource(it) }) }
    }
}
