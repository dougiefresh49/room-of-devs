# Call / chat v2 rationale

The redesign stops asking one screen to be a transcript, player, composer, and live monitor at once.

## What changed from v1

- Chat opens by default with a compact 68px identity row: rounded-square avatar left, status beside it, and Go live/collapse right.
- Real conversation history is the center of chat. Owner turns and agent turns are equally visible.
- Agent history has a small replay affordance only when live is off; owner turns never pretend to be audio clips.
- The three-line composer and separate action row are gone. One bordered shell contains an auto-growing input, dictation, and inline send.
- Idle playback controls are gone. Selecting a clip reveals one 48px now-playing strip above the composer.
- Live no longer stacks into the thread. It becomes a separate, quiet call surface with no composer, keyboard, timeline, or transport.
- The v1 dashed “working” placeholder is replaced by useful transcript-derived tool activity.
- Activity is explicitly visual-only. It fills dead air without synthesizing routine tool events.
- Karaoke returns, but only on the one intermediate currently being spoken.

## One focal object

The call view holds a large, animation-ready avatar and exactly one card: current tool activity, the spoken intermediate, or the final response.
The card changes meaning without changing position, so attention does not chase a growing feed.
The final auto-speaks in place; ending live is the only way to stop call audio.

## Call ⇄ chat

“Send a text” moves the two-screen rail left-to-right, exposing the live chat and keyboard while the call continues.
A pinned Return to call control and compact hang-up button preserve call context above the thread.
Returning slides the rail back to the same call state; ending live returns to ordinary chat.
State F demonstrates this spatial transition directly.

## Cost visibility

Live has a breathing green phone edge plus a small top-center chip reading “LIVE · intermediates use credits.”
Both persist across call and live-chat without consuming a full row.
The activity card separately says tool activity is visual-only and free, clarifying why visible progress is not spoken.

The concept is self-contained vanilla HTML/CSS/JS, uses the app tokens, rounded-square avatars, and models one active clip at a time.
