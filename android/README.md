# Room of Devs for Android Auto

A standard Media3 media app. Open **Room** in Android Auto to see one tile per
project with live sessions, open a project for its album-style list of threads
(the second line reads Working, Done or Error), tap a thread to hear its
update, and use Queue or steering-wheel track buttons for its saved messages.
There is no reply or automatic new-update playback in this version.

## Build

Use JDK 17 and Android SDK 35 (build tools 35.0.0). Dependencies are pinned to
Media3 1.6.1, compatible with the installed SDK 35. No emulator or DHU is needed.

```sh
export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
cd android
./gradlew assembleDebug testDebugUnitTest
./gradlew assembleRelease
```

Debug APK: `app/build/outputs/apk/debug/app-debug.apk`.
Without signing environment variables, release produces
`app/build/outputs/apk/release/app-release-unsigned.apk`.
`versionCode` is `git rev-list --count HEAD` (fallback 1), and `versionName` is
`0.1.<versionCode>`. Build after committing for the final revision count.

For signed release builds, set `ANDROID_KEYSTORE_PATH`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`.
The key stays outside the repository. Debug and release use different signing
keys; uninstall a debug build before installing a signed release. Signed
releases using the same key install over each other.

`.github/workflows/android-release.yml` uses the existing Android signing
secrets. Dispatching it builds a signed `RoomOfDevs.apk` artifact. Pushing an
`android-v*` tag also attaches that APK to a release. The orchestrator manages
the rolling `android-dev` prerelease separately.

## Install and connect

1. Install the signed APK from the owner's `android-dev` release, or use
   `adb install -r app/build/outputs/apk/debug/app-debug.apk` for a local build.
2. Turn on Tailscale on the phone. The Mac and daemon must be reachable.
3. Launch Room of Devs. Paste the complete mobile URL printed by
   `~/.cursor/tts/scripts/mobile_url.sh`, including `?t=...`, and tap Connect.
   Alternatively share that URL from Chrome to Room of Devs, then tap Connect.
4. Check for `Connected: N threads`. The connection is stored in private
   SharedPreferences with application backup disabled. The APK contains no
   owner hostname, IP, or token. HTTP is supported for the Tailscale address.
5. In Android Auto settings, tap Version about ten times to enable developer
   settings. In the menu's Developer settings, turn on Unknown sources.
6. Connect the phone to the car and select Room of Devs as the media source.

Changing the setup connection stops the current player and reconnects the room.
If the service was not running, reconnect Android Auto after setup.

## Playback contract

A tile with `state=hand_raised` starts one
`POST /action` with `{"type":"grant","sessionId":"...","output":"phone"}`.
Duplicate taps for that thread share the outstanding request. POST retries and
redirects are disabled. A failure becomes a player error; another explicit tap
is required. Player reopen, seek, or retry only reuses the original request's
result and cannot dispatch another grant.

The player buffers while the app checks snapshots from the connected SSE feed,
falling back to authenticated `GET /snapshot` when SSE is disconnected. Both use
the same `(epoch, rev)` gate. A fresh GET establishes the pre-tap baseline. It waits up to 25 seconds for a new,
non-ended phone frame for that session (excluding the pre-tap frame and acks),
then up to 120 seconds for synthesis to finish. It streams that exact file via
`GET /replay-audio/<file>` with Range support. This deliberately waits for the
final file, instead of using the phone SPA's progressive `/live-audio/` path.
The service sends `{"type":"phone_done","file":"..."}` once the matching
phone clip finishes, including an automatic transition into the next queue item.

Idle or working tiles without pending updates use `GET /replay-list`, filtered
by session ID and ordered newest first. No grant is sent. The selected clip
plays first, followed by saved replays newest first. Unsynthesized messages are
never added to Queue. Empty history shows `Nothing to play yet`.

Dismiss sends `dismiss_queue` for the selected thread. Slower toggles local
ExoPlayer speed between 1.0 and 0.85. Next hand selects the oldest other raised
thread and uses the same single-dispatch path. No next hand is an unsuccessful
custom command, with no grant.

One SSE connection exists while external controllers are connected; losing the
last controller disconnects it. The feed starts from `onConnect`, not
`onPostConnect`: Media3 never calls `onPostConnect` for legacy
`MediaBrowserCompat` clients, and Android Auto is one, which is why tiles once
froze until the phone was replugged. Media3's internal notification controller
does not keep this connection alive. Reconnects use bounded backoff.

The browse tree (`BrowseTree.kt`, pure and unit-tested) is root, then `room`
(a grid, one `project:<name>` tile per project with live sessions, subtitle
like `1 working · 2 done`, art from the project's most common character), then
each project's `thread:<sessionId>` rows as a list (title is the T3 thread
title, else `label || name`; second line is `Working`, `Done` in green or
`Error` in red when `failed` is set). Threads without a project group under
their character, else `Other`. Projects and rows order by most recent activity.
On every snapshot the service diffs the tree and calls `notifyChildrenChanged`
for each parent whose rows or summaries changed (a thread flipping working to
done notifies its project and the grid). The status colors are
`ForegroundColorSpan`s; AAOS's media center renders them, Android Auto
projection may show the plain word. Avatar paths match mobile,
`/avatars/tmnt/<lowercase-character>/idle.png`, with the same default-art
fallback. Cached PNGs are keyed per character (no status badges, so the host's
per-URI artwork cache never goes stale) and served through a read-only
`content://` provider. Tokens stay in HTTP cookies inside the app, never in
media metadata or artwork URLs sent to Android Auto.

## Daemon and verification

The existing `/replay-list` endpoint already includes filenames and session IDs,
so no HTTP route was added. The only daemon change fills optional `AgentView.project`
from the registered session cwd basename. It reads the registry once per snapshot
build and launches no subprocess. Missing registry/cwd yields null.

The orchestrator must deploy the daemon change with the normal daemon restart.
This lane does not edit or deploy the installed runtime, per its brief. Older
daemons remain usable: the app falls back to the character subtitle.

Tests read the real protocol snapshot fixture and cover URL parsing, ordering,
status words, project grouping and the changed-parent diff, stale-frame gating,
duplicate taps, finalization waits, empty history, and POST failure/redirect
behavior using a local mock HTTP server. No development
test grants against the running daemon or calls Gemini/ElevenLabs.

**Known routing caveat:** every open mobile browser with output set to phone can
also pick up the car's grant. Before listening in the car, close those browser
tabs or set them to Mac output. The app does not change daemon routing.

**Unverified until the owner drives:** Android Auto discovery, grid and list
presentation (the host may ignore the content-style hints), the colored status
words, tiles refreshing in place after a thread finishes, content-provider
artwork, custom-button placement, Queue and steering-wheel controls,
car-speaker playback, and Maps split-screen behavior. Signing with the repository's private release key and
the GitHub workflow require a real CI run. No DHU, emulator, or paid synthesis
was used during implementation.

API references: [MediaLibraryService](https://developer.android.com/media/media3/session/serve-content)
and [background playback](https://developer.android.com/media/media3/session/background-playback).
