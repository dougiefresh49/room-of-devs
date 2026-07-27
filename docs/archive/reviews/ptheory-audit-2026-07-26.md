# Room of Devs — Full Stack Audit

**Date:** 2026-07-26
**Target:** `room-of-devs` @ `57a4b16` (branch `ui-consolidation-round2`)
**Scope:** entire stack — `tts-server/`, `panel/`, `packages/{protocol,room-client,ui,mobile}`, `scripts/`, `config/`, workspace and repo hygiene
**Method:** passive, read-only. No source, config, or dependency was modified. Nothing was installed, built, formatted, executed, or pushed. No live service was probed and no credential was used.
**Disciplines:** security, architecture, performance, code quality, maintainability, UX, accessibility

**Finding discipline:** every finding below was treated as a hypothesis until read in the actual code and subjected to an attempt to disprove it. Findings are labeled **Confirmed** (read the code, tried to disprove, survived) or **Suspected** (mechanism verified, reachability or magnitude unproven). Hypotheses that were disproved are recorded in [Section 10](#10-checked-and-found-sound) so effort is not spent re-flagging them.

---

## Severity scale

| Level        | Meaning                                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Critical** | Remote or local code execution, silent loss of user data or core functionality, or a user-facing failure with no recovery path. Fix before the next run. |
| **High**     | Material security, reliability, or usability degradation. Fix this cycle.                                                                                |
| **Medium**   | Correctness or maintainability debt that will cause a defect under normal evolution.                                                                     |
| **Low**      | Hygiene, polish, and defense-in-depth.                                                                                                                   |

---

## 1. Executive summary

This is a **well-built personal system with a dangerous perimeter and one architectural seam that is generating most of its debt.**

The engineering quality is genuinely above average for a personal project. `strict: true` is on everywhere, there are near-zero `any` casts and no `@ts-ignore`, the `protocol` / `room-client` / `ui` package split is real and load-bearing rather than nominal, the cross-process playback locks are subtle and correct, listener and timer teardown is disciplined, and the code carries load-bearing comments that record real incidents. Several things that usually go wrong here did not: there are **no secrets in any tracked file or anywhere in the 180-commit history**, the committed mobile bundle is clean and current, and the markdown renderer that displays agent-authored text is correctly sanitized.

Three things are seriously wrong.

**First, the perimeter.** The mobile control plane binds `0.0.0.0` over plaintext HTTP by default. Its single bearer token — which is printed in cleartext to a log file and to stdout, carried in a URL query string, and never rotates — authorizes spawning a coding agent **in any directory on the machine** with `--dangerously-skip-permissions` **on by default**, and then injecting arbitrary prompts into it. That is remote code execution as the logged-in user, gated by one immortal token on an unencrypted LAN listener. Nothing else in this report is as urgent.

**Second, a deploy path that destroys a load-bearing runtime file.** `characters.json` is the persona registry. It is gitignored, absent from the repo, and lives inside the directory that `rsync -a --delete` overwrites on **every daemon restart**. The deletion was reproduced deterministically. When it is gone, every agent spawn fails and every voice binding breaks — and it fails silently, because the loader returns `{}` on a missing file.

**Third, one architectural seam is the root cause of most other findings.** The daemon dispatches its own TypeScript through bash, through embedded Python, and back into a _second_ full Node process. Because those processes cannot share memory, every piece of coordination state was pushed onto the filesystem and every piece of domain logic was re-implemented in whichever language the subprocess happened to be. The lockfiles, the tmp+rename ritual, the triplicated `readState`, the 27 Python heredocs, the TypeScript↔bash rule duplication — these are not independent choices. They are all downstream of that one seam.

Underneath all of it: **there is no test runner and no CI that runs anything.** No `package.json` in the workspace defines a `test` script. `pnpm typecheck` and `pnpm check-fixtures` exist and are never run automatically. This is why a 4,330-character line survives in a source file and why two implementations of the same wire contract have silently drifted.

### Findings by severity and category

**106 findings.** Every finding carries an ID, a severity, a category, and a confidence label. The complete register is in [Section 2](#2-complete-finding-register); full write-ups follow in Sections 3–6.

| Severity     | Count   | Meaning for scheduling               |
| ------------ | ------- | ------------------------------------ |
| **Critical** | 6       | Before the next run                  |
| **High**     | 46      | This cycle                           |
| **Medium**   | 31      | Before the subsystem is next touched |
| **Low**      | 23      | Opportunistic; batch into one pass   |
| **Total**    | **106** |                                      |

| Category          | Crit | High | Med | Low | Total | Where it concentrates                                           |
| ----------------- | ---: | ---: | --: | --: | ----: | --------------------------------------------------------------- |
| **Security**      |    2 |    8 |   6 |   6 |    22 | The mobile HTTP perimeter and the shell/OS-integration layer    |
| **Architecture**  |    2 |    8 |   8 |   1 |    19 | The daemon↔bash↔Python↔Node execution seam                      |
| **Performance**   |    0 |    7 |   2 |   6 |    15 | The serial queue drain and synchronous filesystem I/O           |
| **Code quality**  |    0 |   10 |   9 |   7 |    26 | `services/commands.ts`, `index.ts`, and the TS↔bash duplication |
| **Contract**      |    0 |    4 |   4 |   0 |     8 | Protocol schemas that exist and are never enforced              |
| **UX**            |    2 |    6 |   1 |   1 |    10 | Silent failure and fire-and-forget commands in the panel        |
| **Accessibility** |    0 |    3 |   1 |   2 |     6 | The panel's action cluster and mobile's hand-rolled modals      |

Two cross-cutting observations fall out of that table. **Security and architecture own both halves of the Critical row** — the perimeter and the deploy/execution model, not application logic. And **the panel carries every UX and accessibility Critical while mobile carries none**: mobile consistently uses `client.request()` with real failure paths and labelled controls, and the panel consistently fires and forgets. Where the two surfaces disagree, mobile is almost always the correct implementation to port.

### Ordered verdict

Ordered by _what can hurt you soonest_, not by how interesting the problem is.

1. **Close the perimeter** (C-1). Everything else can wait a week; this cannot. It is the only finding that converts network reach into code execution.
2. **Stop destroying `characters.json`** (C-2) and fix the repo-root default (C-3). Both can break a running install today, and C-3 means the daemon may not start on any machine but the author's.
3. **Make failure visible** (C-4, C-5). A lost message that nobody is told about is worse than a crash. Right now a synthesis failure silently swallows the user's update.
4. **Install a floor**: a test runner, and CI that runs `typecheck` + `check-fixtures`. Until this exists, every fix below is unverifiable by inspection.
5. **Then, and only then, the architecture** (R6 → R7). The execution model must be fixed before the state model can be; attempting them in the other order produces incorrect state.

**The non-negotiable bar**, if this system is ever to run anywhere but one trusted laptop:

- No listener binds beyond loopback without TLS and a rotatable, revocable credential.
- No credential is ever written to a log or a URL.
- Permission bypass is opt-in, never default.
- Every deploy path is idempotent and destroys nothing it did not create.
- Every user-visible failure has a user-visible signal.
- Nothing merges that `typecheck` and the contract fixtures have not passed.

Five of those six are currently unmet.

---

## 2. Complete finding register

Every finding, ranked by severity then grouped by category. **Cat** uses: SEC security · ARCH architecture · PERF performance · QUAL code quality and maintainability · CONT wire contract · UX user experience · A11Y accessibility. **Conf** is Confirmed / Suspected. IDs are stable — cite them in issues.

### Critical (6) — fix before the next run

| ID  | Cat  | Conf | Finding                                                                            | Primary location      |
| --- | ---- | ---- | ---------------------------------------------------------------------------------- | --------------------- |
| C-1 | SEC  | Conf | LAN `0.0.0.0` control plane → arbitrary-directory agent spawn with permissions off | `mobile-http.ts:728`  |
| C-2 | ARCH | Conf | `characters.json` deleted by `rsync --delete` and `rm -rf` on every deploy         | `tts-server.sh:40`    |
| C-3 | ARCH | Conf | Daemon repo-root default points at a directory that does not exist                 | `tts-server.sh:13`    |
| C-4 | UX   | Conf | Failed synthesis silently destroys the user's message, with no signal anywhere     | `index.ts:349`        |
| C-5 | UX   | Conf | Panel's primary action is unlabelled, keyboard-dead, and spends credits            | `AgentCard.tsx:69`    |
| C-6 | SEC  | Conf | Untrusted text typed into a permission-disabled agent via `tmux send-keys` + Enter | `inject_prompt.sh:86` |

### High (46) — fix this cycle

**Security (8)**

| ID  | Conf | Finding                                                                     | Location              |
| --- | ---- | --------------------------------------------------------------------------- | --------------------- |
| H-1 | Susp | Cursor hook registered with a relative path → repo-triggered code execution | `config/hooks.json:5` |
| H-2 | Conf | Shell injection + directory escape via unvalidated `session_id`             | `ingest.ts:142-187`   |
| H-3 | Conf | `.env` parser exports arbitrary names, including `PATH` and `DYLD_*`        | `load_env.sh:12-20`   |
| H-4 | Conf | API keys propagated into every spawned child, including the agent itself    | `commands.ts:95-97`   |
| H-5 | Conf | Secrets and conversation text passed as process arguments (`ps`-visible)    | `fetch_voices.py:66`  |
| H-6 | Conf | Verbatim logging of every user prompt and voice transcript, unrotated       | `hook_prompt.sh:25`   |
| H-7 | Conf | `.env` copied to the install world-readable (`cp` preserves mode)           | `setup.sh:31-37`      |
| H-8 | Conf | `--frozen-lockfile` silently degrades to an unpinned install                | `setup.sh:81`         |

**Architecture (8)**

| ID  | Conf | Finding                                                                         | Location                  |
| --- | ---- | ------------------------------------------------------------------------------- | ------------------------- |
| A-1 | Conf | Re-entrant `tsx` — daemon dispatches its own TypeScript through a 2nd Node proc | `index.ts:441-459`        |
| A-2 | Conf | No single source of truth for state; derive-verify-rewrite in place of a lock   | `state.ts:156-165`        |
| A-3 | Conf | Dispatch boundary bypassed by 2 of 4 ingress paths (HID, voice)                 | `hid-actions.ts:14`       |
| A-4 | Conf | `spawnSync` on the request path can stall every client for 10 s                 | `commands.ts:151-153`     |
| A-5 | Conf | Python is an undeclared third language — 27 of 45 scripts embed heredocs        | `scripts/*.sh`            |
| A-6 | Conf | Seven domain concepts duplicated across TypeScript and bash/Python              | `state-watch.ts:196`      |
| A-7 | Conf | Scripts and daemon deploy on different cadences via a 40-name allowlist         | `setup.sh:44-62`          |
| A-8 | Conf | No agent abstraction — "Claude Code" hardcoded across three languages           | `team.sh`, `config.ts:13` |

**Performance (7)**

| ID  | Conf | Finding                                                                   | Measured                    |
| --- | ---- | ------------------------------------------------------------------------- | --------------------------- |
| P-1 | Conf | `session-catalog` reads every transcript in full, synchronously           | 929 ms / 414 MB → 14 ms     |
| P-2 | Conf | Queue drain fully serialized behind playback; nothing overlaps            | 7.6–22 s dead air / 4 items |
| P-3 | Conf | No timeout, retry, or backoff on any paid API call → permanent room wedge | unbounded                   |
| P-4 | Conf | 300 ms chokidar penalty on every item, caused by non-atomic queue writes  | −300 ms per item            |
| P-5 | Conf | Full 25.5 KB snapshot re-broadcast ~2.2×/s during captioned playback      | 56 KB/s per client          |
| P-6 | Conf | `spawnSync("ps")` every 3 s of playback blocks the event loop             | ~100 spawns per message     |
| P-7 | Conf | 562 KB single JS chunk, zero code splitting                               | → ~250 KB achievable        |

**Code quality and contract (14)**

| ID   | Cat  | Conf | Finding                                                                                | Location                    |
| ---- | ---- | ---- | -------------------------------------------------------------------------------------- | --------------------------- |
| Q-1  | CONT | Conf | Wire contract has two implementations; only the weaker one runs, and they have drifted | `commands.ts:352-540`       |
| Q-2  | CONT | Conf | No protocol version field across three independently-deployed halves                   | `packages/protocol/src`     |
| Q-3  | CONT | Conf | Malformed _known_ frames dropped with no trace, indistinguishable from unknown         | `ws-transport.ts:119`       |
| Q-4  | QUAL | Conf | `RoomClient.query()` can hang forever and leak a transport listener                    | `store.ts:150-187`          |
| Q-5  | QUAL | Conf | SSE transport never reconnects after a permanent close                                 | `sse-transport.ts:29`       |
| Q-6  | QUAL | Conf | Ingest bash fallback diverged — drops messages and never raises a hand                 | `ingest_claude_code.sh:120` |
| Q-7  | QUAL | Conf | `effectivePlaybackMode` — four implementations, three different answers                | `hold_room.sh:38`           |
| Q-8  | QUAL | Conf | Replay-slower is 0.85 on one path and 0.80 on three others                             | `commands.ts:832`           |
| Q-9  | QUAL | Conf | `voice.ts` keeps unhardened runner copies, missing the post-incident timeout           | `voice.ts:37-47`            |
| Q-10 | QUAL | Conf | All 17 panel call sites discard the transport's failure return                         | `cluster-actions.ts`        |
| Q-11 | QUAL | Conf | No test runner, no formatter/linter config, and no CI — nothing is enforced            | workspace-wide              |
| Q-12 | QUAL | Conf | README documents a retired SwiftBar menu-bar UI that no longer exists                  | `README.md:149-167`         |
| Q-13 | QUAL | Conf | Three lockfiles, two stale; the install resolves deps unpinned                         | `tts-server.sh:84-90`       |
| Q-14 | QUAL | Conf | 26 of 36 scripts clobber the `TTS_DIR` the daemon exports them                         | `scripts/*.sh`              |

**UX and accessibility (9)**

| ID  | Cat  | Conf | Finding                                                                  | Location                |
| --- | ---- | ---- | ------------------------------------------------------------------------ | ----------------------- |
| U-1 | UX   | Conf | Daemon down: every panel action silently no-ops, cards stay interactive  | `style.css:330`         |
| U-2 | UX   | Conf | "New session" shows a success toast for a command that was never sent    | `PickerView.tsx:162`    |
| U-3 | UX   | Conf | Arcade button refusals emit a log line only — no sound, no notice        | `hid-actions.ts:164`    |
| U-4 | UX   | Conf | Arcade mapping delete: undiscoverable double-click, no confirm, no undo  | `SettingsView.tsx:64`   |
| U-5 | A11Y | Conf | Push-to-talk unreachable by keyboard on every surface                    | `usePttGrant.ts:78`     |
| U-6 | UX   | Conf | "End session" arm state signalled only through a `title` attribute       | `ActionCluster.tsx:130` |
| U-7 | A11Y | Conf | Mobile modals claim `aria-modal` with no focus trap, Escape, or return   | `ConvoSheet.tsx:206`    |
| U-8 | A11Y | Conf | `--room-faint` at 2.82–3.18:1 used for 10–11 px body text (AA needs 4.5) | `tokens.css`            |
| U-9 | UX   | Conf | Same failure handled correctly on mobile and incorrectly on the panel    | `App.tsx:163` vs panel  |

### Medium (31) — fix before the subsystem is next touched

| Category                  | IDs                                      | Count |
| ------------------------- | ---------------------------------------- | ----- |
| Security                  | M-1, M-2, M-11, M-12, M-13, M-14         | 6     |
| Reliability / concurrency | M-4, M-5, M-6, M-7, M-8, M-9, M-10       | 7     |
| Architecture              | M-3, M-15, M-16, M-17, M-18, M-19, M-20  | 7     |
| Code quality              | M-21, M-22, M-26, M-27, M-29, M-30, M-31 | 7     |
| Contract / type modeling  | M-23, M-24, M-25, M-28                   | 4     |

Full text in [Section 5](#5-medium-findings). The three worth reading first: **M-5** (one silent recording leaves playback permanently paused — the defect a user is most likely to actually hit), **M-6** (unlocked cross-process read-modify-write on three shared config files), and **M-27** (a config key the README documents as live that nothing reads).

### Low (23) — batch into one pass

| Category              | IDs                               | Count |
| --------------------- | --------------------------------- | ----- |
| Security hardening    | L-1, L-2, L-3, L-4, L-5, L-8      | 6     |
| Performance polish    | L-9, L-10, L-11, L-12, L-13, L-14 | 6     |
| Code quality / naming | L-6, L-19, L-20, L-21, L-22, L-23 | 6     |
| Repo and toolchain    | L-15, L-16, L-17, L-18            | 4     |
| Least privilege       | L-7                               | 1     |

L-19 through L-23 are the previously unnumbered items now carrying IDs: duplicate `cycle_mode`/`toggle_mode` dropdown entries (L-19), misleading `dnd.ts` / `signal.ts` names with no file comment (L-20), three names for one "end session" concept (L-21), six unused selector exports plus four dead re-exports (L-22), and five drifted comments that actively mislead (L-23).

---

## 3. Critical findings

### C-1 — LAN-exposed control plane grants arbitrary code execution

**Security · Confirmed · Critical**

`tts-server/src/mobile-http.ts:728` binds every interface:

```ts
httpServer.listen(port, "0.0.0.0", () => {
```

`mobile_port: 4785` is a default (`tts-server/src/config.ts:58`) and the server starts whenever it is `> 0` (`tts-server/src/index.ts:490`). The only gate is a single shared bearer token.

What that token authorizes, via `POST /action` → `dispatchPanelAction`:

- **Spawn an agent in any directory.** The directory check is existence only — `tts-server/src/services/commands.ts:344`:
  ```ts
  function isValidDir(dir: string): boolean {
    return existsSync(dir) && statSync(dir).isDirectory();
  }
  ```
  There is no allowlist, despite `knownDirs()` already existing in the same file.
- **With permission prompts disabled, by default.** `tts-server/src/services/commands.ts:638` sets `CR_SKIP_PERMISSIONS` to `"1"` unless the client explicitly sends `skipPermissions: false`, and `scripts/team.sh:106-107` turns that into `--dangerously-skip-permissions`. **The bypass is the default state, not an opt-in.**
- **Then drive it.** `handleReplyAction` (`tts-server/src/services/commands.ts:721`) injects up to 4,000 characters straight into the live agent's prompt.

**Impact.** Anyone on the same network who obtains the token gets arbitrary code execution as the logged-in user. There is no TLS, no rate limiting, no per-action authorization, and no audit trail.

**Aggravating factors, each independently Confirmed:**

- **The token is logged in cleartext.** `mobile-http.ts:730-731` writes the full URL including `?t=<token>` to both `~/.cursor/tts/logs/hook.log` and stdout.
- **It travels in a URL query string** over plaintext HTTP (`mobile-http.ts:108-113`), landing in browser history, history sync, and any intermediary log. The mobile SPA never strips it — there is no `replaceState` anywhere in `packages/mobile/src`.
- **It never rotates.** `stopMobileHttp` deliberately preserves it (`mobile-http.ts:753`, _"Persist token across restarts"_). There is no rotation or revocation path.

**Correctly implemented, and worth recording:** the token comparison uses `timingSafeEqual` (`mobile-http.ts:72-77`), the cookie is `HttpOnly; SameSite=Strict` which blocks LAN CSRF, and DNS rebinding fails because the rebound origin carries no cookie. **The weakness is the transport, the default, and the token's immortality — not the comparison.**

**Fix, in order:**

1. Default `mobile_port` to `0`, or bind `127.0.0.1` and require explicit opt-in (plus a tunnel such as Tailscale) for off-box access.
2. Make `skipPermissions` default **off** — require an explicit `true`.
3. Constrain `spawn_session.dir` to the `knownDirs()` allowlist that already exists.
4. Never log the token; log the URL without it or a fingerprint. `history.replaceState` the query param away once the cookie is seeded.
5. Rotate on daemon start, exactly as `panel_ws_token` already does correctly (`panel-ws.ts:668`).
6. Split the read-only mobile credential from the spawn/inject capability.

---

### C-2 — `characters.json` is destroyed by both deploy paths

**Architecture / Reliability · Confirmed (reproduced) · Critical**

`tts-server/src/characters.json` is the persona registry. It is gitignored (`.gitignore:11`), **is not present in this working tree** (only `characters.example.json` is tracked), and it lives inside the directory both deploy paths overwrite:

- `scripts/tts-server.sh:40` — `rsync -a --delete --exclude=/protocol "$REPO_SERVER_DIR/src/" "$SERVER_DIR/src/"`. The only exclusion is `/protocol`. `--delete` removes any destination file absent from the source.
- `scripts/setup.sh:68` — `rm -rf "$TTS_SERVER_DEST"` then `cp -r`. Unconditional.

**Reproduced deterministically** in a scratch directory using the exact rsync invocation from `tts-server.sh:40` and the exact repo state present on this clone:

```
BEFORE install/src:  characters.json  index.ts
AFTER  install/src:  characters.example.json  index.ts
characters.json present after sync? → DELETED
```

**Blast radius when it is missing** — seven independent code paths read it (`services/commands.ts:56`, `panel-ws.ts:63`, `mobile-http.ts:28`, `session-catalog.ts:8`, `dynamic-response.ts:32`, `scripts/team.sh:14`, `scripts/ptt.sh:64`). `loadCharactersMap()` returns `{}` on a missing file (`services/commands.ts:206-207`), so:

- `listCharacterNames()` → `[]`
- `resolvePersonaName()` → `null` for every persona → **every spawn fails with `bad_persona`**
- `resolveVoiceIdForCharacter()` → `null` → voice bindings break
- `GET /characters` returns `{}`; Gemini loses all character rewriting

It fails **silently at the data layer** — the `existsSync` guard returns `{}`, and a corrupt file is swallowed by a bare `catch`. The only recovery is a manual `cp`, documented in one sentence at `README.md:206`.

**Fix.** Move the persona registry **out of `tts-server/src/`** — it is runtime data, not source, and colocating it is precisely what puts it in `--delete`'s path. Target `~/.cursor/tts/characters.json` alongside `config.json`, seeded from `characters.example.json` by `setup.sh` **only if absent**. That seed-if-absent pattern is already used correctly in the same file for `config.json` (`setup.sh:91-96`) and `arcade_buttons.json` (`setup.sh:154-166`). Five call sites to update.

---

### C-3 — The daemon's repo-root default points at a directory that does not exist

**Architecture / Deploy · Confirmed · Critical**

`scripts/tts-server.sh:13`:

```bash
REPO_SERVER_DIR="${CURSOR_READ_ALOUD_ROOT:-$HOME/projects/cursor-read-aloud}/tts-server"
```

`~/projects/cursor-read-aloud` does not exist. This repo is `room-of-devs`. `CURSOR_READ_ALOUD_ROOT` is referenced in exactly one place in the entire repo — it is not set by `setup.sh`, not present in `config/`, and not documented in `README.md` or `CLAUDE.md`.

So either the daemon fails to start at `tts-server.sh:26-28`, or it silently depends on an undocumented environment variable that exists only in the author's shell. Every `tts-server.sh start` also re-syncs from whatever that variable points at and then executes it — so anything that can set one env var on those calls gets code execution.

**Fix.** Derive the repo root from the script's own location — `$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)` — which is the technique `setup.sh:4-5` and `panel.sh:8-9` already use correctly. Do not accept it from the ambient environment.

---

### C-4 — A failed synthesis silently destroys the user's message

**UX / Reliability · Confirmed · Critical**

Trace with a missing or invalid `ELEVENLABS_API_KEY`:

1. `tts-server/src/elevenlabs.ts:117-120` logs _"No ELEVENLABS_API_KEY — skipping"_, returns `null`.
2. `tts-server/src/index.ts:349-354` — the fallback `streamTTS` also returns `null`, logs _"Stream failed"_, calls `moveToFailed(filePath)`.
3. The item lands in `failed/`.

Verified: `state-watch.ts` never reads `FAILED_DIR`, no snapshot field carries a failure count, and neither UI references `failed` anywhere. The agent's raised hand disappears — the queue file is gone — and **nothing tells the user their update was lost.** They granted the floor, heard silence, and the message no longer exists.

The notice channel that could have reported it has exactly four call sites (`services/commands.ts:650, 671, 690, 805`), all spawn- or live-mode-related. **Nothing in the synthesis, playback, or queue pipeline can reach the user.**

**Fix.** Emit a notice on `moveToFailed`, and add `failedCount` to `PanelSnapshot` so both surfaces can show a persistent badge. A transient toast is the wrong surface for a permanently lost message.

---

### C-5 — The panel's primary action is unlabelled, keyboard-dead, and spends money

**UX / Accessibility · Confirmed · Critical**

`panel/src/app/AgentCard.tsx:69-76` renders the room card as:

```tsx
<div role="button" tabIndex={0} {...gesture}>
```

where `gesture` supplies only mouse and pointer handlers. Two defects compound:

- **No keyboard path.** A `<div role="button">` gets no automatic Enter/Space→click synthesis; the author must wire `onKeyDown` and did not. The card is focusable and advertises itself as a button to assistive technology, and pressing Enter does nothing. `DockView.tsx:223` spreads the _same_ handlers onto a real `<button>`, where Enter does fire — so granting the floor works by keyboard in the dock and not in the room grid.
- **No visible affordance.** No label, no button, no cursor hint indicates that clicking the card grants the floor. Compare mobile (`packages/mobile/src/components/AgentCard.tsx:128-152`), which renders an explicit **"▶ Read update"** with an "on Mac" / "on this phone" sub-label.

A new panel user has no way to learn that clicking a card spends ElevenLabs credits.

**Fix.** Make the card a real `<button>` (or add `onKeyDown` for Enter/Space), and render a visible "Read update" affordance on hand-raised cards, matching mobile.

---

### C-6 — Untrusted text reaches a permission-disabled agent through tmux keystrokes

**Security · Confirmed · Critical**

`scripts/inject_prompt.sh:86-92`:

```bash
MESSAGE="$(printf '%s' "$MSG" | tr -s '[:space:]' ' ')"
send_now() {
    tmux send-keys -t "$TMUX_TARGET" -l -- "$MESSAGE"
    sleep 0.3
    tmux send-keys -t "$TMUX_TARGET" Enter
}
```

Two untrusted feeds reach this: the whisper transcript from push-to-talk (`tts-server/src/voice.ts:66`) and the LAN mobile HTTP `reply` handler (C-1).

The `tmux send-keys -l --` invocation itself is written **correctly** — `-l` sends literal keys and `--` terminates options, so there is no tmux-level injection. The problem is semantic, not syntactic: the text is _typed into a pane_ and _Enter is pressed_. If the pane has fallen back to a shell prompt — the agent exited, crashed, or was interrupted, all expected states per `scripts/team.sh:78` — the message executes as a shell command. If the agent is running, it executes as an unreviewed instruction with permissions disabled.

**Compounding (High, Confirmed):** `inject_prompt.sh:82,89,91` resolves the tmux target **without the `=` exact-match prefix**. tmux falls back to prefix and then fnmatch matching, so `cr-don` matches a session named `cr-donnie`, and a target containing `*` matches by glob. The codebase knows this — `hook_session_end.sh:97` and `team.sh:56,80` both use `=`. The one place that omits it is the one place that types text and presses Enter.

**Fix.** Flip `${CR_SKIP_PERMISSIONS:-1}` to `:-0`. Before `send_now`, verify the pane's foreground process is the expected `claude` binary via `tmux display-message -p '#{pane_current_command}'` and abort otherwise. Use `-t "=$TMUX_TARGET"` at all three sites. Validate `PERSONA` against `^[A-Za-z0-9_-]+$` in `team.sh` before building the session name.

---

## 4. High findings

### Security

**H-1 · Cursor hook registered with a relative command path** — _Suspected_ — `config/hooks.json:5` registers `"./tts/scripts/ingest.sh"`, installed to `~/.cursor/hooks.json` by `setup.sh:210`. The whole thing rests on an undocumented assumption about Cursor's hook working directory. If that cwd is ever the open workspace root rather than `~/.cursor/`, then **opening any repository containing a `tts/scripts/ingest.sh` executes attacker-supplied code on every agent response** — cloning a hostile repo would be sufficient. Marked Suspected because Cursor's actual behavior cannot be verified from this repo. Generate the file at install time with an interpolated absolute path; `setup.sh` already knows `$TTS_DIR`.

**H-2 · Shell injection and directory escape via unvalidated `session_id`** — _Confirmed_ — `tts-server/src/ingest.ts:142-187` slices `session_id` from the hook payload with no validation, builds a filename from it, and then interpolates the resulting path into a shell string: `execSync(\`bash "${notifyScript}" "${filepath}"\`)`. A `session_id`containing`"`breaks out and executes arbitrary commands; one containing`../`escapes`queue/`. The value is normally a UUID from Claude Code, making this a trust-boundary defect rather than a directly reachable exploit — but the file it writes is parsed and its text sent to paid APIs. Validate against `/^[A-Za-z0-9-]{1,64}$/`and replace`execSync`with`spawnSync("bash", [notifyScript, filepath])`.

**H-3 · `.env` parser exports arbitrary variable names including `PATH`** — _Confirmed_ — `scripts/load_env.sh:12-20` does `export "$key=$value"` with no identifier validation and no allowlist. A `.env` containing `PATH=/tmp/evil` or `DYLD_INSERT_LIBRARIES=…` hijacks every subsequent command in the sourcing script, and `generate_sfx.sh:18` sources this before running `curl`. It is also the only script in the layer with no `set` guard at all. Allowlist the two keys actually needed.

**H-4 · API keys propagated into every spawned child, including agent sessions** — _Confirmed_ — `services/commands.ts:95-97` spreads the entire `process.env` into every script invocation, so `team.sh` — which execs `claude --dangerously-skip-permissions` — hands both `ELEVENLABS_API_KEY` and `GEMINI_API_KEY` to the spawned agent. Pass an explicit minimal environment instead.

**H-5 · Secrets and conversation content exposed as process arguments** — _Confirmed_ — `scripts/fetch_voices.py:66-69` and `scripts/generate_sfx.sh:87-91` pass the ElevenLabs key in `curl`'s argv, readable by any local process via `ps`; `generate_sfx.sh` loops twelve times, widening the window. `hook_prompt.sh:40`, `hook_ask_user.sh:59`, and `ingest.sh:33` do the same with full prompt and reply text. Note the codebase is internally inconsistent: `ingest_claude_code.sh:28-29` correctly routes its payload through a temp file. Use stdin or `curl --config -`.

**H-6 · Verbatim logging of user prompts and voice transcripts** — _Confirmed_ — `hook_prompt.sh:25` writes the entire `UserPromptSubmit` payload — every word typed to Claude Code, routinely including pasted credentials — to `hook.log` unconditionally, with no debug gate and no redaction. `hook_ask_user.sh:27` and `ptt.sh:228` do the same. Nothing rotates `hook.log` from the shell side.

**H-7 · `.env` copied to the install without restricting permissions** — _Confirmed_ — `setup.sh:31-37` uses `cp`, which preserves the source mode. A repo `.env` created under a default umask is `0644`, so the installed copy holding both API keys is world-readable. `chmod 600` after the copy.

**H-8 · Lockfile-pinned install silently degrades to unpinned** — _Confirmed_ — `setup.sh:81`: `pnpm install --frozen-lockfile 2>/dev/null || pnpm install`. When the lockfile does not match, diagnostics are discarded and an unpinned resolution runs, pulling whatever the registry currently serves. This turns an intended supply-chain control into a no-op precisely when it would have mattered.

### Architecture

**A-1 · The re-entrant `tsx` execution model** — _Confirmed_ — the root cause of most other architectural findings. Granting the floor goes: WebSocket frame → `runScript("grant_floor.sh")` → bash + three separate `python3` heredocs → `play_node.sh` → `pnpm exec tsx src/index.ts once <file>`, **a second full Node process**. Because the `once` branch (`index.ts:441-459`) sits below the import block, that subprocess loads the entire daemon module graph — `panel-ws`, `mobile-http`, `hid-device` with native `node-hid`, `chokidar`, both AI SDKs — transpiles all of it through `tsx`, and plays one file. The pattern repeats at 13 call sites. `hold_room.sh:103` goes TS → bash → TS. `commands.ts:192` spawns a subprocess for a replay whose in-process implementation the same file calls directly 685 lines later for a _different_ replay command. This is why the state model is file-backed, why logic is duplicated across languages, and why grant latency includes a Node cold start.

**A-2 · No single source of truth for state** — _Confirmed_ — state lives across at least 14 files under `~/.cursor/tts/`. Truth is _derived, not stored_: `deriveState()` (`state.ts:110-116`) reconstructs a session's state at call time, and the stored field is a cache that can disagree — which is why `recomputeAfterPlayback` (`state.ts:156-165`) writes, re-derives, and writes _again_ if the answer changed. That is a hand-rolled optimistic-concurrency retry in place of a lock. `readState` exists three times with three different return shapes (`state.ts:48`, `state-watch.ts:124`, `hid-actions.ts:61`), and the 90-minute ghost-session heuristic is implemented twice independently (`state-watch.ts:250`, `commands.ts:562`).

**A-3 · `services/commands.ts` holds the boundary for only two of four ingress paths** — _Confirmed_ — the file's docstring claims it is "the single place client intents become daemon actions." True for panel WebSocket and mobile HTTP; **false for the arcade HID path** (`hid-actions.ts:14-48`) and **the voice/PTT path** (`voice.ts:23-46`), each of which carries its own `SCRIPTS_DIR` and `runScript`. `SCRIPTS_DIR` is declared five times; there are four independent `runScript` implementations with three different signatures and three different error semantics, two of them both named `runScript` and both exported. A new capability landing in `commands.ts` is silently unavailable to the arcade deck and voice.

**A-4 · `spawnSync` on the request path blocks the entire daemon** — _Confirmed_ — `commands.ts:151-153` documents the hazard honestly, citing a 2026-07-23 incident where a hung `tmux send-keys` froze the daemon for 10+ minutes. The fix applied was a 10-second timeout, not asynchrony. So a single mobile reply can still stall every WebSocket client, every SSE stream, and every HTTP request for up to 10 seconds — and `applySetSetting` does the same for eight of nine settings writes. **The comment reads as a fix; it is a cap on the damage.**

**A-5 · Python is an undeclared third language** — _Confirmed_ — **27 of 45 shell scripts embed `python3` heredocs**, five each in `inject_prompt.sh` and `ptt.sh`, six in `team.sh`. Every one does JSON I/O. This is an unversioned dependency on the system `python3` with no linting, type checking, tests, or CI coverage, in a project documented as Node/TS + React.

**A-6 · Domain logic duplicated across TypeScript and bash/Python** — _Confirmed_ — seven concepts implemented twice or more, including the session state-card shape, `team_map.json` read/write, character→voiceId resolution, `effectivePlaybackMode`, newest-queued-item selection, and the entire Claude Code ingest path. The tell is `state-watch.ts:196`: a TypeScript comment that maintains correctness by **citing a line number in a bash script**.

**A-7 · Scripts and daemon deploy on different cadences** — _Confirmed_ — `tts-server/src/**` re-syncs on every `tts-server.sh restart`; `scripts/*.sh` deploy **only on `setup.sh`**, via a hand-maintained allowlist of 40 filenames (`setup.sh:44-62`). A change to `grant_floor.sh` does not take effect on restart while a change to `commands.ts` does. Both halves of one feature ship on different schedules — this is precisely the channel that produces A-6. Any new script silently fails to deploy until someone remembers the list.

**A-8 · No agent abstraction — "Claude Code" is hardcoded across three languages** — _Confirmed_ — `team.sh` hardcodes the `claude` binary, the `cr-<persona>` tmux naming scheme, and the CLI flag vocabulary; `config.ts:13-14` hardcodes `~/.claude/sessions`; `SPAWN_MODELS` (`commands.ts:606`) hardcodes Claude model aliases, duplicated at `protocol/commands.ts:35`. Adding a second agent type requires touching seven files across TypeScript, bash, and Python. For a system named "Room of Devs," this is the extensibility axis most likely to be needed and least prepared for.

### Performance

**P-1 · `session-catalog` reads every transcript file in full — measured 929 ms, 414 MB** — _Confirmed, measured_ — `tts-server/src/session-catalog.ts:22-40` calls `readFileSync` on each `.jsonl`, then `split("\n")` on the whole thing, then discards all but the first 100 lines. Benchmarked against the real `~/.claude/projects` (383 MB, 388 files): **929 ms and 414 MB read** per uncached scan versus **14 ms** for a bounded 64 KB head read — **66× slower than necessary**. It runs **synchronously on the event loop**, so every WebSocket frame, SSE push, and the queue drain freeze for ~930 ms. Triggered by `GET /picker`, `list_resumable`, and `known_dirs`; the 5-second TTL means a picker refresh stalls the daemon again. The correct technique is already used elsewhere in the same codebase (`services/transcript.ts:77-103`). **Highest value-per-line-changed fix in the report.**

**P-2 · Nothing overlaps — item N+1 is untouched until N finishes playing** — _Confirmed, measured_ — `index.ts:412-431` drains serially, holding the stream lock across Gemini preprocessing, ElevenLabs synthesis, and the **entire ffplay playback lifetime**. Measured latency budget from "agent finishes" to first audible word: **1.9 s best case, 5.5 s worst**, of which Gemini is 1.2–4.0 s. During a 5-minute message the daemon does zero preparatory work for the next item; a four-item drain wastes **7.6–22 s of avoidable dead air**. Prefetching _Gemini only_ for `queue[0]` during playback cuts inter-item latency ~60% at negligible cost (~$0.0001/item). Do **not** prefetch ElevenLabs by default — that spends real credits speculatively and conflicts with the deliberate credit guards throughout this codebase.

**P-3 · A hung paid API call wedges the room permanently** — _Confirmed_ — `gemini.ts:70` and `elevenlabs.ts:40/141/215` issue requests with **no timeout, no `AbortSignal`, no retry, no backoff**. The failure is not merely slow: `processQueueFile` holds the stream lock across the Gemini await, so if the promise never settles, `finally { releaseLock() }` never runs, and every other session's `waitForLock` sees a _live_ holder PID — so the 600-second steal path explicitly refuses to break it. **The room goes silent until manual restart.** `interpreter/llm-router.ts:362` already does this correctly; copy that pattern.

**P-4 · 300 ms fixed penalty on every single item** — _Confirmed_ — `index.ts:543` sets chokidar's `stabilityThreshold: 300`, which exists only because all three queue producers write non-atomically directly into the watched directory (`ingest.ts:172`, `live-tail.ts:111`, `dynamic-response.ts:199`). Write to a tmp file and `rename` — the discipline already used in six other places in this codebase — then drop the threshold. **Six lines, −300 ms on every item, 16% of the best-case latency budget.**

**P-5 · Full 25.5 KB snapshot re-broadcast ~2.2×/s during captioned playback** — _Confirmed, measured_ — caption ticks write `.now-playing.json` every 300 ms, which is watched, which invalidates the snapshot, which broadcasts a **complete** snapshot to every client. Measured payload for a max-length message: **25.5 KB per frame**, of which 13.6 KB is the alignment array and 8.6 KB is text that never changes between frames. That is **56 KB/s per connected client and 16.5 MB over one 5-minute message** — the dominant battery and jank source on a phone. Dropping `alignment` from the snapshot alone halves it.

**P-6 · `spawnSync("ps")` every 3 seconds of every playback** — _Confirmed_ — `player-process.ts:27-41` blocks the event loop for 5–15 ms every 3 s for the entire playback duration (~100 spawns and up to 1.5 s of cumulative freeze per 5-minute message) — delivered precisely while the daemon is broadcasting at 2.2 Hz. Watch the existing pause flag file instead of polling `ps`.

**P-7 · 562 KB single JS chunk, zero code splitting** — _Confirmed_ — `packages/mobile/dist/assets/index-CrcgKso2.js` is 562,585 bytes; there is no `React.lazy` or `Suspense` anywhere in `packages/mobile/src` or `panel/src`. `react-markdown` plus the unified/micromark toolchain is ~180–220 KB of it and is not needed for first paint of the room grid. Lazy-loading the markdown renderer and the four modal sheets targets ~250 KB initial. (`lucide-react` is imported by named specifier and tree-shakes correctly — not a problem.)

### Code quality, contract, and UX

**Q-1 · The wire contract has two implementations and only the weaker one runs** — _Confirmed_ — `packages/protocol/src/commands.ts` defines the full command contract as valibot schemas with a `parseCommand()` entry point. **The daemon never calls it.** `services/commands.ts:352-540` hand-rolls a 189-line key-counting validator over the same 30 command types. Verified: the only consumer of `CommandSchema`/`parseCommand` is `check-fixtures.ts`. The schemas validate a fixture file; the daemon validates traffic; nothing forces them to agree. **They have already drifted** — the schema accepts an empty `sessionId` and any `play_replay.file` string that the daemon rejects, uncapped `reply.text` where the daemon caps at 4,000, and permissive `v.object` where the daemon counts keys exactly. `check-fixtures` will stay green through a complete contract divergence. Replacing the hand-rolled validator with `parseCommand` deletes ~189 lines and single-sources the contract.

**Q-2 · No protocol version field, in a system with three independently-deployed halves** — _Confirmed_ — the daemon, the panel `.app`, and the committed mobile bundle each update on a different path, and there is no `protocolVersion`, no capability handshake, and no negotiation. `PanelSnapshot.epoch` is a boot id, not a contract version. The additive-only rule is enforced solely by discipline, and the existing failure mode is silent by design (Q-3). One optional field plus a client-side banner converts the riskiest class of deploy skew into a visible one.

**Q-3 · Malformed and unknown frames are dropped with no trace** — _Confirmed_ — six silent-swallow sites across `ws-transport.ts:119-127` and `sse-transport.ts:45-123`. Dropping _unknown_ event kinds is correct and contractual. Dropping a **known** kind that failed validation is not — it is indistinguishable from the former, and it is the exact mechanism that would make Q-4 hang forever. Given Q-1 (drift is structurally likely) and Q-2 (no version signal), this is the layer where skew would first become observable, and it is deliberately mute.

**Q-4 · `RoomClient.query()` can hang forever and leak a listener** — _Confirmed_ — `packages/room-client/src/store.ts:150-187`: the reply leg has no timeout, and the listener is removed only inside the three settle branches. When the daemon answers `command_result{ok:true}` but the domain reply frame never arrives — dropped by Q-3, or lost across a reconnect — the promise never settles and the listener is never removed. It lives in the _transport's_ set, unreachable from `dispose()`. The Settings pane spins indefinitely with no error and no log line; each retry adds another permanently-subscribed closure. The `timeoutMs` argument is already threaded through and simply not applied to this leg.

**Q-5 · SSE transport never reconnects after a permanent close** — _Confirmed_ — `sse-transport.ts:29` reports the connection down and never retries. Browsers auto-retry an `EventSource` only on transport drops; on an HTTP error status `readyState` goes to `CLOSED` permanently. When the mobile token is regenerated, the phone's stale cookie 401s, the stream closes for good, and the SPA sits showing "disconnected" forever with no in-app path back. The panel's `WsTransport` is the counterexample and is done right — jittered backoff plus the `FAST_FAIL_URL` trick — and that care should be mirrored.

**Q-6 · Ingest bash fallback has materially diverged and drops messages** — _Confirmed_ — `scripts/hook_stop.sh:24-31` selects between `ingest.ts` and `ingest_claude_code.sh` at runtime; both are live paths. The dedup key diverged: `ingest.ts:64` uses a per-session key **specifically so two sessions finishing with "Done." don't dedup across each other**, and the bash fallback (`:120`) still uses a global key — i.e. it still contains exactly the bug the TypeScript version documents fixing. It also lacks supersede-pending-queue, hand-raise state writes, and the mute check, so **on the fallback path an agent finishing never raises a hand at all.** Delete it and fail loudly; a silently-wrong fallback is worse than an error.

**Q-7 · `effectivePlaybackMode` — four implementations, three different answers** — _Confirmed_ — `config.ts:115-119` (key-presence, returns the raw invalid value), `hold_room.sh:38-41` (value-validity, falls back to `streaming_enabled`), `announce.sh:54-57` and `notify_queued.sh:90-92` (key-presence, yields `"auto"`). `hold_room.sh:29` claims it _"mirrors config.ts"_ — it does not. **This rule gates whether the room speaks at all.**

**Q-8 · Replay-slower is 0.85 on one path and 0.80 on three others** — _Confirmed_ — `rule-router.ts:277` and `llm-router.ts:260` produce 0.85; `commands.ts:832` hardcodes 0.8; the shared UI badge renders "0.8×" and is wrong for the voice path. `coordinator.ts:227-233` **discards the routed speed entirely** and re-dispatches. Four constants for one user intent.

**Q-9 · `voice.ts` keeps private copies of the hardened script runners** — _Confirmed_ — `voice.ts:37-47` re-implements `runScript`/`runSignalReplay` rather than importing the versions in `commands.ts:99-205`, and therefore **lacks the `SYNC_SCRIPT_TIMEOUT_MS` guard added after the 2026-07-23 daemon-freeze incident.** The voice path can still wedge on the exact failure that was already fixed once.

**Q-10 · Panel command sends discard the transport's failure signal** — _Confirmed_ — `WsTransport.send` returns `false` while disconnected and `RoomClient.send` propagates it; **all 17 panel call sites ignore it** (9 in `cluster-actions.ts`, plus `AgentCard.tsx`, `DockView.tsx`, `PickerView.tsx`, `usePttGrant.ts`). See U-1.

**Q-11 · No automated gate runs anywhere — no test runner, no formatter, no CI** — _Confirmed_ — verified against the tracked tree:

- **No `test` script** in any of the seven `package.json` files, and no runner installed — no vitest, no jest, no `node:test`.
- **No linter or formatter configuration of any kind.** A grep for `eslint`, `prettier`, and `biome` across every workspace manifest returns nothing, and no `.prettierrc` / `.eslintrc` / `biome.json` is tracked.
- **No CI.** `git ls-files .github` is empty — there is no workflow directory on either branch, so nothing runs on `origin` at all.
- `tts-server/tsconfig.json` sets `"include": ["src/**/*"]`, so `pnpm typecheck` does not typecheck a single test file.

`pnpm typecheck` and `pnpm check-fixtures` exist in the root `package.json` and are wired to nothing. This is why a 4,330-character line survives in `panel/src/app/SettingsView.tsx:59` — a single JSX expression containing the entire General settings panel, which `wc -l` reports as one of the smallest view files in the panel. Nothing checks.

The absence of a test suite is a documented owner decision (`CLAUDE.md:163,357`) and is not itself the finding. The finding is that **the two mechanical gates that do exist are not enforced**, and one of them cannot currently fail for a reason that matters (Q-1, M-28).

**Q-12 · `docs/archive/` carries stale documentation of retired subsystems** — _Confirmed_ — `README.md:27` correctly notes SwiftBar was retired, yet `README.md:149-167` still presents a full "Menu Bar Controls" table and `:276` instructs generating SFX "From the menu." Per `CLAUDE.md:56-57` the panel is now the only Mac UI. A newcomer would look for a menu bar item that does not exist. Same class of drift as L-23, but in user-facing docs rather than comments.

**Q-13 · Three pnpm lockfiles; two are stale and factually wrong** — _Confirmed_ — `panel/pnpm-lock.yaml` predates the entire React migration (no `react`, no `@room/*`, no `tailwindcss`); `tts-server/pnpm-lock.yaml` omits `valibot`, a declared direct dependency. Neither is consulted by a workspace install, yet `README.md:254` instructs `cd panel && pnpm install`. Worse, `tts-server.sh:84-90` copies only `package.json` to the install and runs a **bare `pnpm install`** — so the daemon you typecheck and the daemon that runs resolve dependencies from different lockfiles. **`pnpm typecheck` is not a statement about the running daemon.**

**Q-14 · 26 of 36 shell scripts ignore the `TTS_DIR` the daemon exports them** — _Confirmed_ — `commands.ts:95-97` deliberately passes `TTS_DIR` to every spawned script; 26 scripts hardcode `TTS_DIR="$HOME/.cursor/tts"` and clobber it. The env plumbing is a no-op for 72% of its consumers, and under a test override half the system writes to the override and half to the real directory.

**U-1 · Daemon down: every panel action silently no-ops** — _Confirmed_ — the only disconnection signals are an 8 px dot with the explanation in a `title` tooltip (`RoomView.tsx:63-66`) and `opacity: 0.48; filter: grayscale(0.65)` on the cards (`style.css:330`) — **with no `pointer-events: none` and no `disabled`.** The cards are greyed and remain fully interactive. A user clicks Pause, Stop, Replay, or Kill and gets no response and no explanation. Worst case: clicking Kill twice on a runaway agent arms and then _disarms_ it, dropping the command, and the card returns to its unarmed state — visually indistinguishable from a successful kill.

**U-2 · "New session" reports success for a command that was never sent** — _Confirmed_ — `PickerView.tsx:162-172` fires `client.send()`, ignores the `false` return, shows "launching Donnie in room-of-devs…", and navigates back to the room after 2 s. With the daemon down the user is returned to a room where no agent will ever appear, with the picker state cleared — a complete dead end. **Mobile does this correctly** with `client.request()` and a real failure path (`App.tsx:163-173`); port it.

**U-3 · Arcade button presses fail silently** — _Confirmed_ — `hid-actions.ts:164,181,191` have three distinct refusal paths, all emitting **only a log line**. No sound, no notice, no panel feedback. The arcade deck exists so the user does not have to look at the screen, so a dead press is indistinguishable from a broken button, a dead USB cable, or a wrong mapping. `emitNotice()` is available and used elsewhere; the HID path never calls it.

**U-4 · Deleting an arcade mapping is an undiscoverable double-click with no confirmation** — _Confirmed_ — `SettingsView.tsx:64`: single click is explicitly a no-op while the tooltip says "Delete mapping." A user clicks once, sees nothing, and has no way to learn the gesture; when they discover it, the delete is immediate with no confirm and no undo, and the physical button must be re-learned via hardware capture to restore it. Inconsistent with the two-click _arm_ pattern used for kill two files away.

**U-5 · Push-to-talk is unreachable by keyboard on every surface** — _Confirmed_ — PTT starts on a 300 ms `onMouseDown` hold timer (`usePttGrant.ts:78-93`); there is no `onKeyDown`/`onKeyUp` equivalent anywhere. Even in the dock, where grant works via synthetic click, hold semantics cannot be produced by a keyboard.

**U-6 · "End session" arm state is signalled only through a `title` attribute** — _Confirmed_ — `ActionCluster.tsx:130-137` implements a two-click arm, but the armed state appears **only** as a changed tooltip — invisible unless hovering, never visible to keyboard users, and the 8-second window expires silently.

**U-7 · Mobile modals claim `aria-modal` without implementing it** — _Confirmed_ — `ConvoSheet.tsx:206-213` and `PlayerSheet.tsx:85` declare `role="dialog" aria-modal="true"` with **no Escape handler, no focus call, no `autoFocus`, and no focus trap.** The attribute _promises_ assistive technology that focus is trapped; Tab escapes to background content and focus is not returned on close. Claiming it without the behavior is worse than omitting it. `packages/ui/src/primitives/` contains eight Radix-backed wrappers that provide all of this for free, **and mobile imports none of them.**

**U-8 · `--room-faint` fails WCAG AA wherever it is used as body text** — _Confirmed, computed_ — `#596474` on `--room-bg #0d1015` is **3.18:1**, and **2.82:1** on `--room-surface` — against a 4.5:1 requirement. It is used for genuine 10–11 px text: project paths, session ids, and timestamps across `style.css:1400,1413`, `PickerSheet.tsx:387`, `ChatView.tsx:263`, `ReplayHistory.tsx:93`. Lightening to ≈`#7d8899` clears AA.

**U-9 · Same failure, opposite handling between surfaces** — _Confirmed_ — spawn failure is the clearest case (U-2), but the pattern is general: mobile's `ConvoSheet.tsx:179-204` distinguishes ok / `not_in_team` / generic failure / timeout, preserves the user's draft on every failure, and announces each case distinctly — **the best error handling in the codebase** — while the panel fires and forgets. Two surfaces, one server, opposite user experience.

---

## 5. Medium findings

### Security and correctness

| ID   | Finding                                                                                                                                                                                                                                                                | File                                                                           |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| M-1  | `reply` bypasses the "server-authoritative" mobile allowlist — intercepted before `dispatchPanelAction` is reached, so `MOBILE_ACTION_TYPES` never sees the highest-impact mobile capability                                                                           | `mobile-http.ts:664-677`                                                       |
| M-2  | Unsanitized session id builds queue filenames; `os.path.join` collapses an embedded `/`. The author built a `safe_cid` sanitizer for the _cache_ path three lines of logic away and did not apply it here                                                              | `ingest.sh:221-225`                                                            |
| M-3  | `CURSOR_READ_ALOUD_ROOT` controls the source of code the daemon executes; `set_mood.sh` and `set_playback_mode.sh` pass the environment straight through                                                                                                               | `tts-server.sh:13,40,131`                                                      |
| M-4  | Long agent replies silently dropped — a reply near `ARG_MAX` makes `execve` fail, `\|\| filepath=""` swallows it, and nothing is logged because the logging lives inside the Python that never started                                                                 | `ingest.sh:33,243`                                                             |
| M-5  | Empty transcript aborts `ptt.sh` under `set -e`, skipping `resume_if_ducked` and cleanup — **a single silent recording leaves TTS playback permanently paused** with orphaned pid/wav/ducked files                                                                     | `ptt.sh:223-226,379-384`                                                       |
| M-6  | Cross-process read-modify-write with no lock on `config.json`, `session_voices.json`, `team_map.json`. tmp+rename gives atomic _replacement_, not atomic _update_; every writer conflates the two. Admitted once in a comment, silently assumed in twelve other places | `now-playing.ts:173-181` et al.                                                |
| M-7  | Inconsistent atomicity: three scripts truncate-and-rewrite in place while the rest of the layer writes atomically — and `team.sh:250` calls one of them during agent launch, plausibly concurrent with a panel write                                                   | `set_session_voice.sh:43`, `set_session_mute.sh:47`, `set_playback_mode.sh:35` |
| M-8  | Retention value unvalidated before mass deletion — a negative `played_retention_count` makes `tail -n` return the entire listing and delete every played file                                                                                                          | `cleanup_played.sh:21-39`                                                      |
| M-9  | `played/`, `failed/`, and `hook.log` retention runs **only at daemon startup**; a long-lived daemon grows unbounded (observed 442 entries against a cap of 50)                                                                                                         | `maintenance.ts:78`, `index.ts:467-468`                                        |
| M-10 | `.last_live_hash_<session>` files are never cleaned — one permanent file per live session                                                                                                                                                                              | `live-tail.ts:70-90`                                                           |
| M-11 | Tauri webview runs with `csp: null` while holding an IPC command that hands out the room-control token to any JS in the page. No live XSS sink exists today, so this is the missing _containment_ layer rather than an open hole                                       | `tauri.conf.json:44`, `lib.rs:15`                                              |
| M-12 | No security response headers on any mobile route, and the SPA never strips `?t=` from the URL                                                                                                                                                                          | `mobile-http.ts:449,470,531`                                                   |
| M-13 | Config parsed with no schema validation despite `valibot` being a declared dependency and never imported in `src/`                                                                                                                                                     | `config.ts:104-108`                                                            |
| M-14 | Transport hardening gaps: no `maxPayload` on the WebSocket server (default 100 MB per frame, each `JSON.parse`d), no ping/pong heartbeat, no request/header timeouts, no rate limit on the endpoint that spawns processes                                              | `panel-ws.ts:688`, `mobile-http.ts`                                            |

### Architecture and code

| ID   | Finding                                                                                                                                                                                                           | File                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| M-15 | Domain logic in the "thin transport adapter": `MOOD_PRESETS`, `VALID_SPEEDS`, `applySetSetting`, `applyButtonPatch` live only in the WebSocket layer, so **mobile cannot set a mood**                             | `panel-ws.ts:69-379`                                            |
| M-16 | Inverted dependency — the daemon reaches two directories up into a frontend package's `public/` folder for avatars; the primary branch is dead in production and live only in dev                                 | `mobile-http.ts:140-144`                                        |
| M-17 | Button-patch merge invariants implemented three times: protocol schema, `parseButtonPatch`, and post-merge re-check                                                                                               | `protocol/commands.ts:66`, `commands.ts:269`, `panel-ws.ts:198` |
| M-18 | Panel hardcodes a 7-entry persona roster while mobile derives it from the server — so a new character appears on mobile and never in the panel, and the labels disagree ("Donnie" vs "Donatello")                 | `personas.ts:8-16`                                              |
| M-19 | `.env` precedence is inverted between TypeScript (environment wins) and shell (file wins)                                                                                                                         | `config.ts:325-349`, `load_env.sh:9-23`                         |
| M-20 | Action→script mapping written out three times, with duplicated user-facing clarify strings                                                                                                                        | `voice.ts:80`, `coordinator.ts:204`, `commands.ts:800`          |
| M-21 | String-matching an error _message_ to recover an exit code, while the same code is mapped correctly 470 lines away. `StepResult` has a `code` field that is never populated                                       | `coordinator.ts:256`                                            |
| M-22 | `applySetSetting` collapses four distinct failures into `false`, so a missing script reports "bad message" and blames the user's input                                                                            | `panel-ws.ts:338-379`                                           |
| M-23 | `NowPlaying` permits states the runtime must defend against — eight optional fields whose validity is tightly correlated and unconstrained; the cost is visible as a wall-clock _staleness belt_ in the selectors | `protocol/snapshot.ts:23-43`                                    |
| M-24 | `AgentView.label` is non-nullable, and the panel's `?? agent.name` fallback is provably dead against the declared type while mobile's `\|\|` is not                                                               | `snapshot.ts:58` + 12 sites                                     |
| M-25 | Stringly-typed settings keys (`{key: string, value: unknown}`) force an alias-rewriting prologue and make a typo indistinguishable from a broken script                                                           | `protocol/commands.ts`                                          |
| M-26 | `getCachedQuery` has zero consumers, so the entire `queryCache` is write-only; the typed query API was built and neither UI adopted it                                                                            | `store.ts:79,190`                                               |
| M-27 | `streaming_enabled` is documented in the README as _"kept in sync with `playback_mode`"_ — verified: **zero code reads it and nothing syncs it**                                                                  | `config/config.json:12`, `README.md:138`                        |
| M-28 | Fixture suite has no coverage assertion and is missing `phone_done`, so the project's only automated contract gate cannot fail for a reason that matters                                                          | `check-fixtures.ts:46-51`                                       |
| M-29 | `reconnecting-websocket@^4.4.0` is abandoned, and the codebase documents an unpatched wedging bug in it whose workaround is load-bearing and would look like dead code to a future cleanup                        | `ws-transport.ts:12-21`                                         |
| M-30 | TypeScript split across two versions (5.9.3 for shared packages, 5.6.3 for the apps) — and the apps typecheck the shared sources with the _older_ compiler                                                        | six `package.json` files                                        |
| M-31 | Character-swap, dock-mode, and several other actions fire and forget; the server can reject with `bad_persona` and no UI branch handles it outside the picker                                                     | `AgentCard.tsx:112`, `DockView.tsx:250`                         |

---

## 6. Low findings

| ID   | Finding                                                                                                                                                                                                            | File                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| L-1  | Origin allowlist is a prefix match — `http://localhost.evil.com` passes, and a missing `Origin` passes unconditionally. Token is the real gate, so this is defense-in-depth that reads as a control and is not one | `panel-ws.ts:121-124`                                |
| L-2  | Panel WS token travels in a URL query string; the comparison is also non-constant-time, unlike the mobile side                                                                                                     | `tauri.ts:176`, `panel-ws.ts:696`                    |
| L-3  | AppleScript built by string interpolation escaping only `"` and not `\`; not reachable from either network surface                                                                                                 | `commands.ts:743-753`                                |
| L-4  | Shell values interpolated into Python string literals at five sites — a single quote in the path executes as Python                                                                                                | `cleanup_played.sh:23` et al.                        |
| L-5  | Hook payload temp file leaks on the error path; `rm -f` sits after the call that can fail under `set -e`                                                                                                           | `ingest_claude_code.sh:184`                          |
| L-6  | Space-delimited `read` from Python output — a space in a session id or voice id shifts every field and the script exits silently                                                                                   | `announce.sh:35,62`                                  |
| L-7  | `dialog:default` grants `allow-save` and `allow-message`; the app only ever calls `open`                                                                                                                           | `capabilities/default.json:23`                       |
| L-8  | Agent-authored markdown rendered to published HTML without sanitization — `marked` passes raw HTML through by default                                                                                              | `docs-publish.mjs:22,29`                             |
| L-9  | Unbounded `completedPlanIds` Set grows monotonically for the process lifetime                                                                                                                                      | `interpreter/plan.ts:38`                             |
| L-10 | New Gemini client constructed per dynamic-ack call, discarding connection pooling; two sibling modules memoize correctly                                                                                           | `dynamic-response.ts:50`                             |
| L-11 | `maxOutputTokens: 4096` permits ~3× more generation than the 4,800-char cap can ever speak, inflating worst-case latency                                                                                           | `gemini.ts:77`                                       |
| L-12 | `rev` increments on every rebuild regardless of content change, defeating client-side rev-gating                                                                                                                   | `state-watch.ts:310`                                 |
| L-13 | `waitForLock` polls at 500 ms; average 250 ms added latency per contended item                                                                                                                                     | `playback-locks.ts:107-127`                          |
| L-14 | `execSync` spawns `/bin/sh -c` → `bash` → script: two extra processes where `spawnSync` needs zero                                                                                                                 | `ingest.ts:187`                                      |
| L-15 | Everything runs through `tsx` with no build step — ~250–450 ms transpile penalty on every one-shot Node invocation the bash layer makes                                                                            | `tts-server/package.json`                            |
| L-16 | Personal username in six absolute paths in tracked documentation                                                                                                                                                   | `docs/archive/reviews/.../codex-run-report.md:55-70` |
| L-17 | No `packageManager`, no `engines`, no `.nvmrc`; the lockfile requires pnpm 9+ and this is stated nowhere. `README.md` lists Rust and Python as prerequisites but not Node or pnpm                                  | root `package.json`, `README.md:32-39`               |
| L-18 | `tts-server` is the one workspace package missing `"private": true` — the only one `npm publish` would not refuse                                                                                                  | `tts-server/package.json`                            |

### Naming, dead code, and comment drift — worth a single pass

| ID   | Finding                                                                                                                                                                                           | File                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| L-19 | `cycle_mode` and `toggle_mode` are two separately-selectable dropdown options with identical `case` fallthrough — users must choose between two identical entries                                 | `hid-actions.ts:120-121`       |
| L-20 | `dnd.ts` and `signal.ts` have no file-level comment and names that actively mislead. In a repo that also contains `drag.ts`, "dnd" reads as drag-and-drop; it is Do-Not-Disturb meeting auto-hold | `dnd.ts`, `signal.ts`          |
| L-21 | "kill" / `kill_team` / "End session" are three names for one concept across the cluster, the command, and the label — so grepping the user-visible string finds nothing                           | `ActionCluster.tsx:39,132`     |
| L-22 | Six unused selector exports and four dead re-exports; the panel uses no selectors at all while mobile uses four, so each surface reimplements the other's half                                    | `selectors.ts`, `voice.ts:208` |
| L-23 | Five drifted comments that actively mislead. Worst: `ui-state.ts:1-9` justifies an awkward external store with a rationale about a legacy `render()` and island portals that **no longer exist**  | `ui-state.ts:1-9`              |

L-23 is the one to prioritize in this group: a maintainer reading it will preserve an awkward pattern to satisfy a constraint that was removed.

---

## 7. Architectural recommendations

Ranked by leverage. The sequencing matters — R6 must precede R7 or the result is incorrect.

### Tier 1 — Fix now; a live install can break today

**R1 · Make `characters.json` a real, deploy-safe artifact.** _(C-2)_ Move it out of `tts-server/src/` to `~/.cursor/tts/characters.json`, seeded if absent. The seed-if-absent pattern already exists twice in the file you would edit. Five call sites.

**R2 · Fix the repo-root default.** _(C-3)_ Derive from the script's own location, as two sibling scripts already do.

**R3 · Close the perimeter.** _(C-1, C-6)_ Bind loopback by default; `skipPermissions` opt-in; allowlist spawn directories; stop logging the token; rotate it; `-t "=$TARGET"` on tmux.

**R4 · Pin the install's dependency resolution.** _(Q-13)_ Sync the lockfile and use `--frozen-lockfile`. Without this, `pnpm typecheck` says nothing about what actually runs.

**R5 · Deploy scripts by directory, not by a hand-maintained allowlist, on the same cadence as the daemon.** _(A-7)_ This closes the drift channel that produces A-6.

### Tier 2 — The structural fix

**R6 · Delete the re-entrant `tsx` layer.** _(A-1)_ This is the change that makes everything else possible.

- Kill `index.ts once` (`index.ts:441-459`). Granting becomes an in-process `processQueueFile()` call. `grant_floor.sh`'s actual job — find the newest queue file for a session, respect mute — is ~15 lines of TypeScript **that already exist twice** in `state-watch.ts:194-222`.
- Kill every `pnpm exec tsx src/*.ts` in `scripts/` (13 sites). `signal.ts`, `announce.ts`, `phrases.ts`, and `state.ts recompute` are already daemon modules — call them.
- **Keep the file-drop queue.** Hooks are separate processes by definition; `queue/` is a legitimate restart-surviving message queue and chokidar is the right consumer. Do not touch this.
- Introduce one typed async `ProcessRunner`, replacing four `runScript` variants and five `SCRIPTS_DIR` constants. `spawnSync` disappears from every request path (A-4).

Expected outcome: grant latency loses a full Node cold start; `playback-locks.ts` shrinks to its hook-facing role; `commands.ts` becomes genuinely authoritative.

**R7 · Then collapse the state layer.** _(A-2)_ A single in-process `RoomState` owning sessions, team map, live flags, and now-playing, with the filesystem as a write-through journal and hooks as the only external writers. Eliminates the derive-verify-rewrite loop, the duplicated ghost heuristics, the three `readState`s, the 2-second snapshot TTL, and the read-modify-write races.

**Do not attempt R7 before R6** — in-process state is _wrong_ while synthesis runs in a subprocess.

**R8 · Make the protocol schema authoritative on the server.** _(Q-1)_ Replace the 189-line hand-rolled validator with `parseCommand`, tightening the schemas to encode what the daemon actually enforces. One definition, one drift surface, ~189 lines deleted. **Interim step if a full swap is too risky:** extend `check-fixtures.ts` to run _both_ validators over the fixtures and fail on disagreement — that alone converts silent drift into a build failure.

### Tier 3 — Cleanup, low risk

**R9** Move `MOOD_PRESETS`, `VALID_SPEEDS`, `applySetSetting`, and `applyButtonPatch` into `commands.ts` — mechanical, and it makes moods and settings reachable from mobile and voice for free. **R10** Route HID and voice through `commands.ts` dispatch, deleting their private runners. **R11** Delete `ingest_claude_code.sh` and its `hook_stop.sh` fallback branch — it is unreachable in practice (pnpm is a hard requirement) and silently wrong (Q-6). **R12** One asset root resolved from config, not a relative path into a sibling package. **R13** Delete the `panel-ws.ts:45-60` re-export shim once callers migrate. **R14** Migrate the surviving Python heredocs — most disappear as a side effect of R6.

### Explicitly leave alone

These came up as suspects and are **correct**. Re-flagging them wastes effort.

- **`packages/protocol` / `room-client` / `ui`.** A real shared kernel with clean dependency direction and no cycles. `RoomClient`'s `(epoch, rev)` staleness gate and optimistic-grant rollback are subtle and right.
- **The two-transport client design.** Adding a client surface costs ~2 files. This is the system's best axis — protect it.
- **`playback-locks.ts`.** The `takeoverStale` rename technique is correct and the comments explaining why bare unlink+`wx` races are exactly right.
- **The committed `packages/mobile/dist`.** Deliberate, documented, working, with a correct fatal-on-missing check. Do not extend the pattern; do not remove it.
- **The `queue/` file-drop as the hook→daemon boundary**, including the startup-recovery watermark logic.
- **Streaming where it matters.** `streamWithTimestamps` is the right call (same billing, free alignment), chunks pipe into ffplay as they arrive, and the early-stop drain correctly finishes writing the replay so already-paid-for audio is not lost. Gemini being non-streamed is also correct — the full text is needed before synthesis for correct prosody.
- **The credit guards.** The three char caps, the 4× lower fallback cap, `hasNewerLiveItem` skipping stale intermediates _before_ synthesis, the phrase audio disk cache, and the 30-minute live silence auto-off are well-considered cost controls.
- **Listener and timer hygiene.** Every `subscribe`, `onNotice`, `watchFile`, and `setInterval` traced has a matching teardown, and both SIGTERM and SIGINT stop every subsystem. Unusually disciplined.

---

## 8. Optimization plan

Ordered by measured value per line changed. Items 1–3 are each under fifteen lines and carry no architectural risk.

| #   | Change                                                          | Measured effect                                                                   | Size      |
| --- | --------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------- |
| 1   | Bounded 64 KB head read in `session-catalog.ts:22-40`           | **929 ms → 14 ms**; removes a full-second event-loop freeze from the picker path  | ~10 lines |
| 2   | Atomic queue writes + drop `stabilityThreshold`                 | **−300 ms on every single item**                                                  | ~6 lines  |
| 3   | Timeouts + retry/backoff on Gemini and ElevenLabs               | Removes the permanent-wedge failure mode (P-3)                                    | ~15 lines |
| 4   | Prefetch Gemini for `queue[0]` during playback                  | **~60% off multi-item drain latency**; 4-item drain 7.6–22 s → 3.1–9.1 s          | Medium    |
| 5   | Drop `alignment` from the snapshot payload                      | **56 KB/s → 26 KB/s per client**; proportionally less phone re-render and battery | Medium    |
| 6   | Replace the `spawnSync("ps")` suspend-healer with flag watching | Removes 5–15 ms event-loop freezes every 3 s of playback                          | Small     |
| 7   | Lazy-load `react-markdown` and the four modal sheets            | **562 KB → ~250 KB initial bundle**                                               | Small     |
| 8   | Call retention + log rotation from the existing 60 s reaper     | Stops unbounded `played/`, `failed/`, and log growth                              | 2 lines   |
| 9   | Batch `tmux list-sessions` instead of N+1 `has-session` spawns  | Collapses up to 7 sequential blocking spawns per agent launch to 1                | Small     |
| 10  | Add a `build` script and run from `dist/` rather than `tsx`     | ~200–370 ms per shelled-out Node invocation                                       | Small     |

**Measured and found to be noise — do not prioritize.** These _look_ expensive and are not: the `statSync` "storm" over 442 `played/` files costs **0.96 ms**; re-reading `session_voices.json` once per agent costs **0.066 ms**; the per-agent queue-preview parse costs **0.067 ms**; `JSON.stringify` on the 25.5 KB snapshot costs **0.018 ms** per client per frame. Even at 2.2 rebuilds/second these total roughly 0.2% of one core. Fix them opportunistically if you are already editing `buildSnapshot`; they are not why anything is slow.

---

## 9. The testing and CI gap

This is called out separately because it underwrites the rest of the report.

**Current state, verified:**

- **No `test` script in any of the seven `package.json` files.** No test runner is installed anywhere — no vitest, no jest, no `node:test`.
- Eight self-executing scripts exist (`tts-server/test-*.ts`, `smoke-mobile.ts`, ~810 lines) that must be run by hand. Three describe themselves as "Scratch" tests in their own headers.
- `tts-server/tsconfig.json` sets `"include": ["src/**/*"]`, so **`pnpm typecheck` does not typecheck a single test file.**
- **There is no CI.** `git ls-files .github` is empty on both branches — no workflow exists, so nothing runs on `origin`.
- **There is no linter or formatter configuration.** No `eslint`, `prettier`, or `biome` entry in any manifest, and no config file tracked.

**What is untested:** the queue state machine in `index.ts` (mode gating, live-mode races, phone-grant admission), cross-process lock takeover, the early-stop drain, replay finalize/abort, `validatePanelMessage` — **the primary input validator** — the interpreter routing, and the entire ingest path.

The absence of a test suite is a documented owner decision (`CLAUDE.md:163,357`) and is **not** being reported as a defect. What _is_ a defect is that the two mechanical gates which do exist — `pnpm typecheck` and `pnpm check-fixtures` — are not wired to anything, and one of them (Q-1, M-28) cannot currently fail for a reason that matters.

**Minimum viable floor**, in order:

1. Add a `.github/workflows/` job — there is none today — running `pnpm typecheck` and `pnpm check-fixtures` as required steps on every push.
2. Add a `test` script and widen the tsconfig include so the existing scripts at least typecheck.
3. Add the both-validators fixture assertion from R8 — it turns the highest-severity contract finding into a build failure.
4. Table-driven tests for `validatePanelMessage` and `playback-locks` before anything else.

Several findings in this report — notably the queue-admission refactor (`index.ts:138-385`, a 248-line function on the daemon's critical path) and the `AudioController` split (1,195 lines, ~35 mutable fields encoding five overlapping state machines) — are **effectively unreviewable by inspection until a test runner exists.** Do not attempt them first.

---

## 10. Checked and found sound

Recorded so these are not re-flagged on a future pass. Each was an active hypothesis that was **disproved**.

| Hypothesis                                                                     | Verdict                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secrets in tracked files                                                       | **No.** Nothing matching key/token/PEM patterns anywhere in `git ls-files`. Only `your_key_here` placeholders and a correct `"${ELEVENLABS_API_KEY:-}"` env read.                                                                                                                                                    |
| Secrets in git history                                                         | **No.** `git log --diff-filter=A` across all 180 commits shows no `.env`, `*.pem`, `*.key`, or `credentials.*` ever added. Nothing to rewrite.                                                                                                                                                                       |
| Secrets in the committed 549 KB mobile bundle                                  | **No.** No JWT / `sk-` / `xox` / AWS patterns, no `/Users/` paths, no LAN IPs. The `sk-` matches were substrings of Tailwind mask-image variables.                                                                                                                                                                   |
| The committed `dist/` is stale                                                 | **No.** `git log <build-commit>..HEAD -- packages/*/src` returns empty, and a post-build CSS class is present in the bundle.                                                                                                                                                                                         |
| XSS via the agent-markdown renderer                                            | **No.** `rehype-sanitize` runs on the hast before the component map sees `href`, and react-markdown v10 does not enable raw HTML without `rehype-raw`, which is absent. Zero `dangerouslySetInnerHTML` / `innerHTML` / `eval` across all three client packages.                                                      |
| Path traversal on the file-serving routes                                      | **No.** `safePathUnder` rejects `\0` and any `..` substring and re-verifies with a resolved-prefix check; `safeReplayName` requires `basename(raw) === raw`; the thread route is regex-gated.                                                                                                                        |
| Script-name injection in the shell-out layer                                   | **No.** Every `runScript*` call site passes a hardcoded literal; arguments go through `spawn` argv with no shell. (The one exception is H-2.)                                                                                                                                                                        |
| `eval "$(python3 …)"` in the session-end hook                                  | **No.** The Python emits `shlex.quote`'d assignments. The `eval` is unnecessary but not injectable.                                                                                                                                                                                                                  |
| `terminal-notifier -execute` and the AppleScript escaper in `notify_queued.sh` | **No.** Both path and session id are `shlex.quote`'d; the AppleScript escaper handles both special characters, and newlines are stripped upstream.                                                                                                                                                                   |
| `mktemp` as a symlink or predictable-path vector                               | **No.** `O_EXCL`, mode 0600. The only issue is cleanup ordering (L-5).                                                                                                                                                                                                                                               |
| Tauri IPC over-exposure                                                        | **No.** No `fs`, `shell`, or `http` plugin; both capabilities are `local: true`; no updater to hijack; the Rust commands validate input and neither interpolates caller input into a path or shell. The mode-transition state machine holds its mutex across the whole transition and rolls back on partial failure. |
| `.gitignore`'s `!packages/mobile/dist/` negation is broken                     | **No.** `git check-ignore` confirms the re-inclusion works and other `dist/` dirs stay ignored.                                                                                                                                                                                                                      |
| Unused dependencies in `@room/ui`                                              | **No.** All 13 are imported.                                                                                                                                                                                                                                                                                         |
| Wildcard, unpinned, or git-URL dependencies                                    | **No.** No `*`, `latest`, `>=`, or git specifiers in any manifest.                                                                                                                                                                                                                                                   |
| `tts-server/src/protocol` is a copied clone that has diverged                  | **No.** It is a symlink into `packages/protocol/src`, documented as the intentional deploy mechanism. Types are genuinely shared; the gap is that the daemon's _runtime validator_ ignores the shared _schemas_.                                                                                                     |
| Status is encoded by color alone throughout                                    | **Narrowly, not systemically.** `StateBadge` correctly pairs the dot with a text label everywhere it is used on both platforms. Only the dock pill dropped the label (U-8 scope).                                                                                                                                    |
| Reduced motion is unhandled                                                    | **Panel is correct** — a blanket universal-selector override covering every keyframe. Mobile has a narrow gap: it only wraps its own classes and never reaches three infinite animations inherited from `@room/ui/components.css`.                                                                                   |
| Memory and listener leaks in the clients                                       | **No.** `wireAudio` runs once; every `addEventListener` traced has a matching removal; PTT guarantees exactly one stop on unmount/blur/visibility-loss; the stage engine cancels both its RAF and its watchdog on dispose.                                                                                           |
| Dead scripts in `scripts/`                                                     | **None.** Every `.sh` / `.py` / `.mjs` has at least one live reference. Do not hunt here.                                                                                                                                                                                                                            |
| Transcript fetch is unbounded                                                  | **No.** `GET /thread/` defaults to 40 items and slices the tail over an 8 MB-capped parse. Transcript _rendering_ may be an issue; transcript _fetch_ is not.                                                                                                                                                        |

---

## 11. Method, limits, and provenance

**How this was produced.** Seven independent read-only review streams — four security (daemon, shell and OS-integration layer, clients, shared packages and repo hygiene) and three quality (architecture, performance, code quality plus UX) — each instructed to treat every finding as a hypothesis and attempt to disprove it before reporting. Results were then reconciled: overlapping findings were merged, severity was normalized to one scale, and the load-bearing Critical claims were independently re-verified against the source before publication.

**Independently re-verified for this report** (not taken on a reviewer's word):

- `mobile-http.ts:728` binds `0.0.0.0`; `commands.ts:638` and `team.sh:106-107` make the permission bypass the default; `isValidDir` is existence-only — read directly.
- `tts-server.sh:40` excludes only `/protocol`; `characters.json` is gitignored, absent from the tree, and read by seven code paths — read directly.
- **The `characters.json` deletion was reproduced** in a scratch directory using the exact rsync invocation and the exact repo state, on this machine's rsync. Result: `DELETED`.
- No `"test"` script exists in any workspace manifest — grepped directly.

**Limits, stated plainly:**

- **Passive only.** Nothing was executed, built, installed, or probed. No live service was contacted and no credential was used. Runtime behavior is inferred from source.
- **Dependency CVE status is unverified.** `npm audit` requires network access and was not run. `react-markdown@^10`, `rehype-sanitize@^6`, and the abandoned `reconnecting-websocket@^4.4.0` should be checked separately.
- **H-1 is Suspected, not Confirmed** — it depends on Cursor's hook working directory, which cannot be determined from this repo. It is listed High because the failure mode is severe if the assumption is wrong.
- Performance figures marked "measured" were benchmarked against real on-disk data (`~/.claude/projects`, 383 MB / 388 files) or computed from the code's own constants. `~/.cursor/tts` does not exist on the audit machine, so queue and playback directory counts come from the code's retention constants and an in-repo comment citing 442 observed entries.
- P-5's client-side half is **Confirmed in mechanism, unconfirmed in magnitude** — the server-side broadcast loop was measured; the React re-render cost was not instrumented.

**Not done, by engagement constraint:** no code was changed, no fix was applied, no dependency was installed, no formatter was run, nothing was committed, and nothing was pushed. Every recommendation in this document is advisory. The owner decides what to act on.
