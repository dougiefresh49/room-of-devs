package com.dougiefresh49.roomofdevs

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.view.View
import android.widget.*
import kotlinx.coroutines.*

class SetupActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var field: EditText
    private lateinit var status: TextView
    private lateinit var connect: Button
    private lateinit var projects: LinearLayout
    private lateinit var projectStatus: TextView
    private var loading: Job? = null
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val (scroll, layout) = scrollingColumn(this)
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
            text = "How fast the car plays updates. 1× is the voice's natural pace."
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
        layout.addView(TextView(this).apply {
            text = "Project voices"; textSize = 18f; setPadding(0, 48, 0, 8)
        })
        layout.addView(TextView(this).apply {
            text = "Every session in a project speaks in its character's voice, unless it has its own."
        })
        projectStatus = TextView(this).apply { setPadding(0, 16, 0, 0) }
        layout.addView(projectStatus)
        projects = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        layout.addView(projects)
        setContentView(scroll)
        receive(intent)
        ConnectionPrefs.load(this)?.let { test(it, save = false) }
    }
    /** Refreshes on every return, so the picker's save shows up when it finishes. */
    override fun onResume() { super.onResume(); loadProjects() }
    private fun loadProjects() {
        loading?.cancel()
        val api = ConnectionPrefs.load(this)?.let(::RoomApi) ?: run {
            projects.removeAllViews()
            showProjectStatus("Connect to the room to pick project voices.")
            return
        }
        if (projects.childCount == 0) showProjectStatus("Loading projects…")
        loading = scope.launch {
            try {
                val payload = api.projectVoices()
                projects.removeAllViews()
                payload.projects.forEach { project ->
                    projects.addView(voiceRow(this@SetupActivity, project.name, project.voiceLabel, null, R.drawable.ic_chevron) {
                        startActivity(CharacterPickerActivity.intent(this@SetupActivity, project, payload.characters))
                    })
                }
                showProjectStatus(if (payload.projects.isEmpty()) "No projects yet." else "")
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                showProjectStatus("Could not load project voices. Check Tailscale and that the Mac is awake.")
            }
        }
    }
    private fun showProjectStatus(text: String) {
        projectStatus.text = text
        projectStatus.visibility = if (text.isEmpty()) View.GONE else View.VISIBLE
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
                    loadProjects()
                }
                status.text = "Connected: ${snapshot.agents.size} threads"
            } catch (_: Exception) {
                status.text = "Could not connect. Check the mobile URL, Tailscale, and that the Mac is awake."
            } finally { connect.isEnabled = true }
        }
    }
    override fun onDestroy() { scope.cancel(); super.onDestroy() }
}
