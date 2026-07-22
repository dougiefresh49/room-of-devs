/**
 * @room/protocol — the shared wire contract between the tts-server daemon,
 * the desktop panel, and the mobile room page.
 *
 * Rules of the package:
 * - React/browser-free (valibot is the only dependency).
 * - Schemas are the source of truth; every exported type is inferred.
 * - Additive evolution only: unknown event kinds and unknown keys must be
 *   ignorable by clients; the daemon strips-and-accepts envelope fields
 *   (requestId, source) on commands.
 *
 * Deploy note: the installed daemon (~/.cursor/tts/tts-server) must never
 * resolve modules back into this repo — tts-server.sh stages this package's
 * src/ into the install as plain files (src/protocol/), and the repo's
 * tts-server/src/protocol symlink points here so both layouts resolve the
 * same relative imports.
 */
export * from "./snapshot.js";
export * from "./commands.js";
export * from "./events.js";
