package com.dougiefresh49.roomofdevs

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.view.WindowInsets
import android.widget.*
import kotlinx.coroutines.*

class SetupActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var field: EditText
    private lateinit var status: TextView
    private lateinit var connect: Button
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
            setOnApplyWindowInsetsListener { view, insets ->
                val bars = insets.getInsets(WindowInsets.Type.systemBars())
                view.setPadding(32 + bars.left, 32 + bars.top, 32 + bars.right, 32 + bars.bottom)
                insets
            }
        }
        layout.addView(TextView(this).apply { text = "Room of Devs"; textSize = 28f })
        layout.addView(TextView(this).apply { text = "Paste your mobile URL, or share it here from Chrome. Connect Tailscale first." })
        field = EditText(this).apply {
            hint = "Mobile URL"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            importantForAutofill = android.view.View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
            isSaveEnabled = false
            setSingleLine()
        }
        layout.addView(field)
        connect = Button(this).apply { text = "Connect"; setOnClickListener { connect() } }
        layout.addView(connect)
        status = TextView(this)
        layout.addView(status)
        layout.addView(TextView(this).apply {
            text = "Playback speed"; textSize = 18f; setPadding(0, 48, 0, 8)
        })
        layout.addView(TextView(this).apply {
            text = "Multiplies each character's own pace, same as the speed control on the mobile page."
        })
        val speeds = RadioGroup(this).apply { orientation = RadioGroup.HORIZONTAL }
        val current = ConnectionPrefs.speed(this)
        ConnectionPrefs.SPEED_STEPS.forEach { step ->
            speeds.addView(RadioButton(this).apply {
                id = android.view.View.generateViewId()
                text = if (step % 1.0 == 0.0) "${step.toInt()}×" else "${step}×"
                isChecked = step == current
                setOnClickListener { ConnectionPrefs.saveSpeed(this@SetupActivity, step) }
            })
        }
        layout.addView(speeds)
        setContentView(layout)
        receive(intent)
        ConnectionPrefs.load(this)?.let { test(it, save = false) }
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); receive(intent) }
    private fun receive(intent: Intent) {
        if (intent.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            val shared = intent.getStringExtra(Intent.EXTRA_TEXT).orEmpty()
            val url = Regex("https?://[^\\s]+").find(shared)?.value ?: shared
            field.setText(url)
        }
    }
    private fun connect() {
        val connection = runCatching { Connection.parse(field.text.toString()) }.getOrElse {
            status.text = it.message; return
        }
        test(connection, save = true)
    }
    private fun test(connection: Connection, save: Boolean) {
        connect.isEnabled = false
        status.text = "Connecting…"
        scope.launch {
            try {
                val snapshot = RoomApi(connection).snapshot()
                if (save) {
                    ConnectionPrefs.save(this@SetupActivity, connection)
                    field.text.clear()
                    startService(Intent(this@SetupActivity, RoomMediaService::class.java).setAction(RoomMediaService.RECONFIGURE))
                }
                status.text = "Connected: ${snapshot.agents.size} threads"
            } catch (_: Exception) {
                status.text = "Could not connect. Check the mobile URL, Tailscale, and that the Mac is awake."
            } finally { connect.isEnabled = true }
        }
    }
    override fun onDestroy() { scope.cancel(); super.onDestroy() }
}
