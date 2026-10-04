package com.dougiefresh49.roomofdevs

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.LinearLayout
import android.widget.TextView
import kotlinx.coroutines.*
import kotlinx.serialization.builtins.ListSerializer

/** Pick one project's character. A tap saves at once and returns; a failed save stays here. */
class CharacterPickerActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var rows: LinearLayout
    private lateinit var status: TextView
    private var saving: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val project = intent.getStringExtra(EXTRA_PROJECT).orEmpty()
        val current = intent.getStringExtra(EXTRA_VOICE_ID).orEmpty()
        val characters = runCatching {
            wireJson.decodeFromString(ListSerializer(VoiceCharacter.serializer()), intent.getStringExtra(EXTRA_CHARACTERS).orEmpty())
        }.getOrDefault(emptyList())
        val api = ConnectionPrefs.load(this)?.let(::RoomApi)
        val (scroll, layout) = scrollingColumn(this)
        layout.addView(TextView(this).apply { text = project; textSize = 28f })
        layout.addView(TextView(this).apply { text = "Every session in this project speaks in this voice unless it has its own." })
        status = TextView(this).apply { setPadding(0, 16, 0, 16) }
        layout.addView(status)
        rows = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        layout.addView(rows)
        setContentView(scroll)
        if (api == null || project.isBlank()) {
            status.text = "Not connected to the room. Connect on the setup screen first."
            return
        }
        rows.addView(voiceRow(this, "Default", "The room's default voice", AvatarImages.view(this, scope, api, "default", "–"),
            R.drawable.ic_check.takeIf { current.isBlank() }) { save(api, project, "") })
        characters.forEach { c ->
            rows.addView(voiceRow(this, c.name, null, AvatarImages.view(this, scope, api, c.name, c.name.take(1).uppercase()),
                R.drawable.ic_check.takeIf { c.voiceId == current }) { save(api, project, c.voiceId) })
        }
        if (characters.isEmpty()) status.text = "The room listed no characters."
    }

    private fun save(api: RoomApi, project: String, voiceId: String) {
        if (saving?.isActive == true) return
        setRowsEnabled(false)
        status.text = "Saving…"
        saving = scope.launch {
            try {
                api.setProjectVoice(project, voiceId)
                setResult(RESULT_OK)
                finish()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                status.text = "Could not save. Check Tailscale and that the Mac is awake, then try again."
                setRowsEnabled(true)
            }
        }
    }

    private fun setRowsEnabled(enabled: Boolean) {
        for (i in 0 until rows.childCount) rows.getChildAt(i).apply { isEnabled = enabled; alpha = if (enabled) 1f else 0.5f }
    }

    override fun onDestroy() { scope.cancel(); super.onDestroy() }

    companion object {
        private const val EXTRA_PROJECT = "project"
        private const val EXTRA_VOICE_ID = "voiceId"
        private const val EXTRA_CHARACTERS = "characters"
        fun intent(context: Context, project: ProjectVoice, characters: List<VoiceCharacter>) =
            Intent(context, CharacterPickerActivity::class.java)
                .putExtra(EXTRA_PROJECT, project.name)
                .putExtra(EXTRA_VOICE_ID, project.voiceId.orEmpty())
                .putExtra(EXTRA_CHARACTERS, wireJson.encodeToString(ListSerializer(VoiceCharacter.serializer()), characters))
    }
}
