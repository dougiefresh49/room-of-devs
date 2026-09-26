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
        private const val ROOT = "root"
        private const val ROOM = "room"
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
    private val controllers = mutableSetOf<MediaSession.ControllerInfo>()
    private var selection: PlaybackRequest? = null
    private var selectionVersion = 0L
    private var selectedThread: String? = null
    private var completedFile: String? = null
    private var selectedFile: String? = null
    /** Per-clip daemon tempo by replay file; the car plays clip rate x speed setting (x 0.85 when Slower). */
    private val clipRates = java.util.concurrent.ConcurrentHashMap<String, Double>()
    private var slower = false
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
            }).setLoadErrorHandlingPolicy(object : DefaultLoadErrorHandlingPolicy(0) {
                override fun getRetryDelayMsFor(info: LoadErrorInfo) = C.TIME_UNSET
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
        )
        feedJob = scope.launch {
            var previous: List<Agent>? = null
            nextFeed.snapshots.collect { snapshot ->
                val ordered = roomOrder(snapshot?.agents.orEmpty())
                if (ordered != previous) {
                    previous = ordered
                    tiles.keys.retainAll(ordered.map { it.sessionId }.toSet())
                    session.notifyChildrenChanged(ROOM, ordered.size, null)
                }
            }
        }
        if (controllers.isNotEmpty()) nextFeed.start()
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

    private fun folder(id: String, title: String) = MediaItem.Builder().setMediaId(id)
        .setMediaMetadata(MediaMetadata.Builder().setTitle(title).setIsBrowsable(true).setIsPlayable(false)
            .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED).setExtras(gridHints()).build()).build()
    private fun gridHints() = Bundle().apply {
        putInt("android.media.browse.CONTENT_STYLE_BROWSABLE_HINT", 2)
        putInt("android.media.browse.CONTENT_STYLE_PLAYABLE_HINT", 2)
        putBoolean("android.media.browse.CONTENT_STYLE_SUPPORTED", true)
    }
    private suspend fun tile(agent: Agent): MediaItem {
        val art = artwork?.uri(agent)
        return MediaItem.Builder().setMediaId("thread:${agent.sessionId}")
            .setMediaMetadata(MediaMetadata.Builder().setTitle(agent.title).setSubtitle(agent.subtitle)
                .setArtist(agent.subtitle).setArtworkUri(art).setIsBrowsable(false).setIsPlayable(true)
                .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC).build()).build().also { tiles[agent.sessionId] = it }
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
            selection = request; selectedThread = agent.sessionId; completedFile = null; selectedFile = null
            scope.launch {
                try {
                    val playlist = request.audio.await()
                    playlist.forEach { r -> r.playbackRate?.takeIf { it > 0 }?.let { clipRates[r.file] = it } }
                    if (selectionVersion == version) { selectedFile = playlist.first().file; applySpeed() }
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
        player.setPlaybackSpeed((clip * ConnectionPrefs.speed(this) * if (slower) 0.85 else 1.0).toFloat())
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
            return MediaSession.ConnectionResult.AcceptedResultBuilder(session).setAvailableSessionCommands(commands.build()).build()
        }
        override fun onPostConnect(session: MediaSession, controller: MediaSession.ControllerInfo) {
            if (!session.isMediaNotificationController(controller)) {
                controllers.add(controller); feed?.start()
            }
        }
        override fun onDisconnected(session: MediaSession, controller: MediaSession.ControllerInfo) {
            controllers.remove(controller)
            if (controllers.isEmpty()) feed?.stop()
        }
        override fun onGetLibraryRoot(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, params: LibraryParams?) =
            Futures.immediateFuture(LibraryResult.ofItem(folder(ROOT, "Room of Devs"), LibraryParams.Builder().setExtras(gridHints()).build()))
        override fun onGetChildren(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, parentId: String, page: Int, pageSize: Int, params: LibraryParams?): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> = future {
            if (page < 0 || pageSize < 1) return@future LibraryResult.ofError(SessionError.ERROR_BAD_VALUE)
            val items = when (parentId) {
                ROOT -> listOf(folder(ROOM, "Room"))
                ROOM -> {
                    val snapshot = feed?.snapshots?.value ?: feed?.refresh()
                    roomOrder(snapshot?.agents.orEmpty()).map { tile(it) }
                }
                else -> return@future LibraryResult.ofError(SessionError.ERROR_BAD_VALUE)
            }
            val start = (page.toLong() * pageSize).coerceAtMost(items.size.toLong()).toInt()
            LibraryResult.ofItemList(items.drop(start).take(pageSize), params)
        }
        override fun onGetItem(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, mediaId: String): ListenableFuture<LibraryResult<MediaItem>> = future {
            val item = when (mediaId) {
                ROOT -> folder(ROOT, "Room of Devs")
                ROOM -> folder(ROOM, "Room")
                else -> feed?.snapshots?.value?.agents?.find { "thread:${it.sessionId}" == mediaId }?.let { tile(it) }
            }
            if (item == null) LibraryResult.ofError(SessionError.ERROR_BAD_VALUE) else LibraryResult.ofItem(item, null)
        }
        override fun onSubscribe(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, parentId: String, params: LibraryParams?): ListenableFuture<LibraryResult<Void>> {
            session.notifyChildrenChanged(browser, parentId, if (parentId == ROOT) 1 else feed?.snapshots?.value?.agents?.size ?: 0, params)
            return Futures.immediateFuture(LibraryResult.ofVoid())
        }
        override fun onSetMediaItems(session: MediaSession, controller: MediaSession.ControllerInfo, mediaItems: List<MediaItem>, startIndex: Int, startPositionMs: Long): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            val id = mediaItems.getOrNull(startIndex.coerceAtLeast(0))?.mediaId ?: ""
            val agent = feed?.snapshots?.value?.agents?.find { id == "thread:${it.sessionId}" }
            if (agent != null) return Futures.immediateFuture(MediaSession.MediaItemsWithStartPosition(listOf(select(agent)), 0, 0))
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
