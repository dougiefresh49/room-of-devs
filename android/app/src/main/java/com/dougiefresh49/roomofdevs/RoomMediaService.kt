package com.dougiefresh49.roomofdevs

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.media3.common.*
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy.LoadErrorInfo
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.session.*
import androidx.media3.session.MediaLibraryService.MediaLibrarySession
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.*
import kotlinx.coroutines.*
import java.io.IOException

@UnstableApi
class RoomMediaService : MediaLibraryService() {
    companion object {
        const val RECONFIGURE = "com.dougiefresh49.roomofdevs.RECONFIGURE"
        private const val ROOT = BrowseTree.ROOT
        private const val ROOM = BrowseTree.ROOM
        private const val DONE_GREEN = 0xFF66BB6A.toInt()
        private const val ERROR_RED = 0xFFEF5350.toInt()
        private const val DISMISS = "room.dismiss"
        private const val SLOWER = "room.slower"
        private const val NEXT = "room.next_hand"
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var player: ExoPlayer
    private lateinit var session: MediaLibrarySession
    private var api: RoomApi? = null
    private var feed: RoomFeed? = null
    private var artwork: ArtworkCache? = null
    private var requests: PlaybackRequests? = null
    private var feedJob: Job? = null
    private var selection: PlaybackRequest? = null
    private var selectionVersion = 0L
    private var selectedThread: String? = null
    private var completedFile: String? = null
    private var selectedFile: String? = null
    /** Per-clip daemon tempo by replay file; the car plays clip rate x speed setting (x 0.85 when Slower). */
    private val clipRates = java.util.concurrent.ConcurrentHashMap<String, Double>()
    private var slower = false
    private var selectedLive = false
    private val speedListener = android.content.SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
        if (key == ConnectionPrefs.SPEED_KEY) applySpeed()
    }
    private val tiles = mutableMapOf<String, MediaItem>()
    private val custom = listOf(
        Triple(DISMISS, "Dismiss", R.drawable.ic_dismiss),
        Triple(SLOWER, "Slower", R.drawable.ic_slower),
        Triple(NEXT, "Next hand", R.drawable.ic_next_hand),
    )

    override fun onCreate() {
        super.onCreate()
        player = ExoPlayer.Builder(this).setMediaSourceFactory(
            DefaultMediaSourceFactory(DataSource.Factory {
                RoomDataSource(requireNotNull(api), requireNotNull(requests))
            }).setLoadErrorHandlingPolicy(object : DefaultLoadErrorHandlingPolicy() {
                // Live-tail reconnects live in RoomDataSource (bounded, resumes at ?from=). A
                // terminal error is fatal here so ExoPlayer never restarts the tail from byte 0.
                override fun getRetryDelayMsFor(info: LoadErrorInfo): Long {
                    val terminal = generateSequence<Throwable>(info.exception) { it.cause }.any { it is TerminalRoomException }
                    return if (terminal) C.TIME_UNSET else super.getRetryDelayMsFor(info)
                }
            }),
        ).setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).build(), true)
            .setHandleAudioBecomingNoisy(true).setWakeMode(C.WAKE_MODE_LOCAL).build()
        // Exo errors can carry URLs in causes. Only a safe, useful message leaves this player.
        val publicPlayer = object : ForwardingSimpleBasePlayer(player) {
            private var originalError: PlaybackException? = null
            private var publicError: PlaybackException? = null
            override fun getState(): State {
                val state = super.getState()
                val error = state.playerError ?: return state
                if (error !== originalError) {
                    originalError = error
                    val nothing = generateSequence<Throwable>(error) { it.cause }.any { it.message == "Nothing to play yet" }
                    publicError = PlaybackException(
                        if (nothing) "Nothing to play yet" else "Update unavailable; tap the thread again",
                        null, error.errorCode,
                    )
                }
                return state.buildUpon().setPlayerError(publicError).build()
            }
        }
        session = MediaLibrarySession.Builder(this, publicPlayer, Callback())
            .setSessionActivity(PendingIntent.getActivity(this, 0, Intent(this, SetupActivity::class.java), PendingIntent.FLAG_IMMUTABLE))
            .setCustomLayout(custom.map { (action, name, icon) ->
                CommandButton.Builder(CommandButton.ICON_UNDEFINED).setDisplayName(name).setCustomIconResId(icon)
                    .setSessionCommand(SessionCommand(action, Bundle.EMPTY)).build()
            }).build()
        player.addListener(object : Player.Listener {
            override fun onPositionDiscontinuity(old: Player.PositionInfo, new: Player.PositionInfo, reason: Int) {
                if (reason == Player.DISCONTINUITY_REASON_AUTO_TRANSITION) ackFinished(old.mediaItem)
            }
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) ackFinished(player.currentMediaItem)
            }
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) = applySpeed()
        })
        ConnectionPrefs.prefs(this).registerOnSharedPreferenceChangeListener(speedListener)
        configure()
    }
    private fun configure() {
        selectionVersion++
        feedJob?.cancel(); feed?.stop(); requests?.close()
        player.stop(); player.clearMediaItems(); selection = null; selectedThread = null
        tiles.clear(); api = null; feed = null; requests = null; artwork = null
        val connection = ConnectionPrefs.load(this) ?: return
        val nextApi = RoomApi(connection)
        val nextFeed = RoomFeed(nextApi, scope)
        api = nextApi; feed = nextFeed; artwork = ArtworkCache(this, nextApi)
        requests = PlaybackRequests(scope, nextFeed::refresh, nextApi::replays,
            { id -> nextApi.action("grant", "sessionId" to id, "output" to "phone") },
            pollSnapshot = nextFeed::currentOrRefresh,
            current = { nextFeed.snapshots.value },
        )
        feedJob = scope.launch {
            var previous: List<ProjectGroup>? = null
            nextFeed.snapshots.collect { snapshot ->
                val agents = snapshot?.agents ?: return@collect
                val projects = BrowseTree.projects(agents)
                // Every parent whose rows or summaries moved gets re-requested by its subscribed
                // browser; a thread flipping working -> done touches its project and the Room grid.
                for (parent in BrowseTree.changedParents(previous, projects)) {
                    val count = if (parent == ROOM) projects.size else projects.find { it.id == parent }?.agents?.size ?: 0
                    session.notifyChildrenChanged(parent, count, null)
                }
                previous = projects
                tiles.keys.retainAll(agents.map { it.sessionId }.toSet())
            }
        }
        if (browsing) nextFeed.start()
    }
    /**
     * A client (Android Auto's legacy browser) is bound. Media3 never prunes legacy browsers from
     * connectedControllers, so the feed's lifetime follows binding instead: on from onConnect or any
     * browse, off in onUnbind when the last client unbinds (the car unplugged).
     */
    private var browsing = false
    override fun onUnbind(intent: Intent?): Boolean {
        browsing = false
        feed?.stop()
        return super.onUnbind(intent)
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == RECONFIGURE) configure()
        return super.onStartCommand(intent, flags, startId)
    }
    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo) = session
    override fun onDestroy() {
        ConnectionPrefs.prefs(this).unregisterOnSharedPreferenceChangeListener(speedListener)
        feed?.stop(); requests?.close(); scope.cancel(); session.release(); player.release()
        super.onDestroy()
    }

    /** Content-style hints on a browsable item describe how its children are laid out. */
    private fun styleHints(browsable: Int, playable: Int) = Bundle().apply {
        putInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_BROWSABLE, browsable)
        putInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_PLAYABLE, playable)
    }
    private val grid get() = styleHints(MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_GRID_ITEM, MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_GRID_ITEM)
    private val list get() = styleHints(MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM, MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM)
    private fun folder(id: String, title: String, hints: Bundle) = MediaItem.Builder().setMediaId(id)
        .setMediaMetadata(MediaMetadata.Builder().setTitle(title).setIsBrowsable(true).setIsPlayable(false)
            .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED).setExtras(hints).build()).build()
    /** A project tile on the Room grid: album-style, its children listed under the project name. */
    private suspend fun projectTile(project: ProjectGroup): MediaItem {
        val art = artwork?.uri(project.character, project.name)
        return MediaItem.Builder().setMediaId(project.id)
            .setMediaMetadata(MediaMetadata.Builder().setTitle(project.name).setSubtitle(project.summary)
                .setArtist(project.summary).setArtworkUri(art).setIsBrowsable(true).setIsPlayable(false)
                .setMediaType(MediaMetadata.MEDIA_TYPE_ALBUM).setExtras(list).build()).build()
    }
    /**
     * Done is green and Error red through a ForegroundColorSpan. AAOS's media center passes the
     * subtitle CharSequence straight to its TextView; a host that strips spans still shows the word.
     */
    private fun statusText(agent: Agent): CharSequence {
        val status = agent.status
        val color = when (status) { Status.DONE -> DONE_GREEN; Status.ERROR -> ERROR_RED; Status.WORKING -> return status.label }
        return android.text.SpannableString(status.label).apply {
            setSpan(android.text.style.ForegroundColorSpan(color), 0, length, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
    }
    private suspend fun threadRow(agent: Agent): MediaItem {
        val art = artwork?.uri(agent.character, agent.title)
        val status = statusText(agent)
        return MediaItem.Builder().setMediaId(BrowseTree.threadId(agent.sessionId))
            .setMediaMetadata(MediaMetadata.Builder().setTitle(agent.title).setSubtitle(status)
                .setArtist(status).setArtworkUri(art).setIsBrowsable(false).setIsPlayable(true)
                .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC).build()).build().also { tiles[agent.sessionId] = it }
    }
    /** The live snapshot when the stream is open, else one fresh GET; a failed GET keeps the last value. */
    private suspend fun agents(): List<Agent> {
        val current = feed ?: return emptyList()
        browsing = true; current.start()
        return (runCatching { current.currentOrRefresh() }.getOrNull() ?: current.snapshots.value)?.agents.orEmpty()
    }
    private fun replayItem(replay: Replay, agent: Agent) = MediaItem.Builder().setMediaId("replay:${replay.file}")
        .setUri(Uri.Builder().scheme("room").authority("replay").appendPath(replay.file).build())
        .setMimeType(MimeTypes.AUDIO_MPEG)
        .setMediaMetadata(MediaMetadata.Builder().setTitle(replay.textPreview?.takeIf { it.isNotBlank() } ?: agent.title)
            .setArtist(agent.title).setSubtitle(agent.subtitle).setArtworkUri(tiles[agent.sessionId]?.mediaMetadata?.artworkUri)
            .setIsPlayable(true).setIsBrowsable(false).build()).build()

    /** Synchronous tap registration means duplicate callbacks share a single outstanding grant. */
    private fun select(agent: Agent): MediaItem {
        val manager = requests ?: throw IOException("Set up Room of Devs on your phone")
        val request = manager.tap(agent)
        if (selection?.id != request.id) {
            val version = ++selectionVersion
            selection = request; selectedThread = agent.sessionId; completedFile = null; selectedFile = null; selectedLive = false
            scope.launch {
                try {
                    val playlist = request.audio.await()
                    playlist.forEach { r -> r.playbackRate?.takeIf { it > 0 }?.let { clipRates[r.file] = it } }
                    if (selectionVersion == version) {
                        selectedFile = playlist.first().file; selectedLive = playlist.first().live; applySpeed()
                    }
                    // Wait until MediaSession has installed this tap's placeholder item.
                    withTimeout(5_000) {
                        while (selectionVersion == version && player.currentMediaItem?.mediaId != "request:${request.id}") delay(20)
                    }
                    if (selectionVersion == version) {
                        player.addMediaItems(playlist.drop(1).map { replayItem(it, agent) })
                    }
                } catch (_: Exception) { /* DataSource surfaces the terminal failure to the player. */ }
            }
        }
        return (tiles[agent.sessionId] ?: MediaItem.Builder().setMediaMetadata(
            MediaMetadata.Builder().setTitle(agent.title).setArtist(agent.subtitle).setIsPlayable(true).build(),
        ).build()).buildUpon().setMediaId("request:${request.id}")
            .setUri("room://request/${request.id}").setMimeType(MimeTypes.AUDIO_MPEG).build()
    }
    private fun applySpeed() {
        val id = player.currentMediaItem?.mediaId
        val file = if (id?.startsWith("replay:") == true) id.removePrefix("replay:") else selectedFile
        val clip = file?.let(clipRates::get) ?: 1.0
        // A live tail can't sustain more than the clip's own rate (the mobile page's rule).
        val live = selectedLive && id?.startsWith("request:") == true
        val mult = if (live) 1.0 else ConnectionPrefs.speed(this)
        player.setPlaybackSpeed((clip * mult * if (slower) 0.85 else 1.0).toFloat())
    }
    private fun ackFinished(item: MediaItem?) {
        val id = item?.mediaId ?: return
        val file = if (id.startsWith("replay:")) id.removePrefix("replay:")
        else if (id == "request:${selection?.id}") selectedFile ?: return else return
        val np = feed?.snapshots?.value?.nowPlaying
        if (np?.output == "phone" && np.endedAt == null && np.replayFile == file && completedFile != file) {
            completedFile = file
            scope.launch { runCatching { api?.action("phone_done", "file" to file) } }
        }
    }
    private fun <T> future(block: suspend () -> T): ListenableFuture<T> {
        val result = SettableFuture.create<T>()
        val job = scope.launch { try { result.set(block()) } catch (e: Exception) { result.setException(e) } }
        result.addListener({ if (result.isCancelled) job.cancel() }, MoreExecutors.directExecutor())
        return result
    }

    private inner class Callback : MediaLibrarySession.Callback {
        override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
            val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon()
            custom.forEach { commands.add(SessionCommand(it.first, Bundle.EMPTY)) }
            // Media3 never calls onPostConnect for legacy (MediaBrowserCompat) clients, and Android
            // Auto is one, so the feed has to start here or the car browses a frozen snapshot.
            if (!session.isMediaNotificationController(controller)) { browsing = true; feed?.start() }
            return MediaSession.ConnectionResult.AcceptedResultBuilder(session).setAvailableSessionCommands(commands.build()).build()
        }
        override fun onGetLibraryRoot(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, params: LibraryParams?) =
            Futures.immediateFuture(LibraryResult.ofItem(folder(ROOT, "Room of Devs", grid), LibraryParams.Builder().setExtras(grid).build()))
        override fun onGetChildren(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, parentId: String, page: Int, pageSize: Int, params: LibraryParams?): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> = future {
            if (page < 0 || pageSize < 1) return@future LibraryResult.ofError(SessionError.ERROR_BAD_VALUE)
            val items = when (parentId) {
                ROOT -> listOf(folder(ROOM, "Room", grid))
                ROOM -> BrowseTree.projects(agents()).map { projectTile(it) }
                else -> {
                    val name = BrowseTree.projectName(parentId) ?: return@future LibraryResult.ofError(SessionError.ERROR_BAD_VALUE)
                    BrowseTree.project(agents(), name)?.agents?.map { threadRow(it) } ?: emptyList()
                }
            }
            val start = (page.toLong() * pageSize).coerceAtMost(items.size.toLong()).toInt()
            LibraryResult.ofItemList(items.drop(start).take(pageSize), params)
        }
        override fun onGetItem(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, mediaId: String): ListenableFuture<LibraryResult<MediaItem>> = future {
            val current = feed?.snapshots?.value?.agents.orEmpty()
            val item = when (mediaId) {
                ROOT -> folder(ROOT, "Room of Devs", grid)
                ROOM -> folder(ROOM, "Room", grid)
                else -> BrowseTree.projectName(mediaId)?.let { name -> BrowseTree.project(current, name)?.let { projectTile(it) } }
                    ?: BrowseTree.sessionId(mediaId)?.let { sid -> current.find { it.sessionId == sid }?.let { threadRow(it) } }
            }
            if (item == null) LibraryResult.ofError(SessionError.ERROR_BAD_VALUE) else LibraryResult.ofItem(item, null)
        }
        override fun onSubscribe(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, parentId: String, params: LibraryParams?): ListenableFuture<LibraryResult<Void>> {
            val current = feed?.snapshots?.value?.agents.orEmpty()
            val count = when (parentId) {
                ROOT -> 1
                ROOM -> BrowseTree.projects(current).size
                else -> BrowseTree.projectName(parentId)?.let { BrowseTree.project(current, it)?.agents?.size } ?: 0
            }
            session.notifyChildrenChanged(browser, parentId, count, params)
            return Futures.immediateFuture(LibraryResult.ofVoid())
        }
        override fun onSetMediaItems(session: MediaSession, controller: MediaSession.ControllerInfo, mediaItems: List<MediaItem>, startIndex: Int, startPositionMs: Long): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            val id = mediaItems.getOrNull(startIndex.coerceAtLeast(0))?.mediaId ?: ""
            val agent = feed?.snapshots?.value?.agents?.find { id == BrowseTree.threadId(it.sessionId) }
            if (agent != null) {
                val item = select(agent)
                // A re-tap that reuses the playing request keeps its Queue history.
                val installed = (0 until player.mediaItemCount).map(player::getMediaItemAt)
                val at = installed.indexOfFirst { it.mediaId == item.mediaId }
                return Futures.immediateFuture(
                    if (at >= 0) MediaSession.MediaItemsWithStartPosition(installed, at, 0)
                    else MediaSession.MediaItemsWithStartPosition(listOf(item), 0, 0),
                )
            }
            // Some hosts select a queue entry by media ID rather than seekTo(index).
            // Resolve against our installed playlist, never controller-supplied URIs.
            val queue = (0 until player.mediaItemCount).map(player::getMediaItemAt)
            val queueIndex = queue.indexOfFirst { it.mediaId == id }
            if (queueIndex >= 0) return Futures.immediateFuture(MediaSession.MediaItemsWithStartPosition(queue, queueIndex, 0))
            return Futures.immediateFailedFuture(IllegalArgumentException("Choose a thread from Room"))
        }
        override fun onCustomCommand(session: MediaSession, controller: MediaSession.ControllerInfo, command: SessionCommand, args: Bundle): ListenableFuture<SessionResult> = future {
            try {
                when (command.customAction) {
                    DISMISS -> selectedThread?.let { api?.action("dismiss_queue", "sessionId" to it) }
                        ?: return@future SessionResult(SessionError.ERROR_BAD_VALUE)
                    SLOWER -> { slower = !slower; applySpeed() }
                    NEXT -> {
                        val next = roomOrder(feed?.snapshots?.value?.agents.orEmpty()).firstOrNull { it.hasUpdate && it.sessionId != selectedThread }
                            ?: return@future SessionResult(SessionError.ERROR_BAD_VALUE)
                        player.setMediaItem(select(next)); player.prepare(); player.play()
                    }
                    else -> return@future SessionResult(SessionError.ERROR_NOT_SUPPORTED)
                }
                SessionResult(SessionResult.RESULT_SUCCESS)
            } catch (_: Exception) { SessionResult(SessionError.ERROR_IO) }
        }
    }
}
