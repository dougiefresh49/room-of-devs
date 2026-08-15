#!/bin/bash
# Artifact 3: overnight-watchdog.sh, verbatim (state: working sketch, armed Thu night Aug 7; cited by retro §4.7).
# overnight-watchdog.sh — resume the orchestrator Claude session if it stalls
# on the 5-hour usage wall while unattended. Untracked; local tooling only.
#
# Arm before bed (alongside `caffeinate -dims`):
#   nohup scripts/overnight-watchdog.sh >> /tmp/overnight-watchdog.log 2>&1 &
#
# Logic: the AgentUsageBar snapshot gives the current 5h window's resetsAt.
# window_start = resetsAt - 5h. If the newest session transcript went quiet
# BEFORE the current window started and is still quiet 10+ min into it, the
# session almost certainly died on the limit -> fire a headless resume of the
# most recent session in this project. The resume prompt is idempotent: it
# checks for a live orchestrator (recent commits/PR activity) and exits if
# one exists, so a false positive costs nothing.

REPO="/Users/dougiefresh49/projects/headliner-bulk-scheduling"
SNAPSHOT="$HOME/Library/Application Support/AgentUsageBar/usage-snapshot.json"
TRANSCRIPTS="$HOME/.claude/projects/-Users-dougiefresh49-projects-headliner-bulk-scheduling"
CLAUDE_BIN="$(command -v claude)"
MAX_LIFETIME_HOURS=10
MAX_FIRES=3
WINDOW_SECS=18000   # 5h
QUIET_SECS=1500     # 25 min of silence counts as quiet
GRACE_SECS=600      # wait 10 min into the new window before judging

RESUME_PROMPT='Resuming the overnight run after a possible usage-limit stall.
FIRST: check whether another orchestrator is already active — any commit,
PR comment, or issue-label change in this repo within the last 15 minutes
means one is; if so, print "orchestrator alive, exiting" and stop.
Otherwise: re-read AGENTS.md and tracker issue #19, reconcile actual state
(open PRs, review status, worktrees, free-rein labels) against the overnight
loop instructions from earlier in this conversation, and continue the loop
from wherever it truly is. If the MVP-1 backlog is complete, post the summary
on #19 and stop.'

log() { echo "$(date '+%F %T') watchdog: $*"; }

[ -z "$CLAUDE_BIN" ] && { log "claude binary not found; aborting"; exit 1; }
start_epoch=$(date +%s)
fires=0
log "armed (max ${MAX_LIFETIME_HOURS}h, max ${MAX_FIRES} resumes)"

while true; do
  sleep 300
  now=$(date +%s)
  (( now - start_epoch > MAX_LIFETIME_HOURS * 3600 )) && { log "lifetime reached, exiting"; exit 0; }

  reset=$(jq -r '.providers.claude.metrics[] | select(.id=="five_hour") | .resetsAt' "$SNAPSHOT" 2>/dev/null)
  [ -z "$reset" ] || [ "$reset" = "null" ] && continue
  reset_epoch=$(date -ju -f "%Y-%m-%dT%H:%M:%SZ" "$reset" +%s 2>/dev/null) || continue
  window_start=$(( reset_epoch - WINDOW_SECS ))

  newest=$(ls -t "$TRANSCRIPTS"/*.jsonl 2>/dev/null | head -1)
  [ -z "$newest" ] && continue
  last_ts=$(stat -f %m "$newest")

  # Healthy: activity within the current window, or window too young to judge.
  (( last_ts >= window_start )) && continue
  (( now < window_start + GRACE_SECS )) && continue
  (( now - last_ts < QUIET_SECS )) && continue

  log "stall detected: last activity $(date -r "$last_ts" '+%F %T'), window started $(date -r "$window_start" '+%F %T') — firing resume"
  ( cd "$REPO" && "$CLAUDE_BIN" --continue --dangerously-skip-permissions -p "$RESUME_PROMPT" ) >> /tmp/overnight-resume.log 2>&1
  fires=$(( fires + 1 ))
  log "resume run #$fires finished (see /tmp/overnight-resume.log)"
  (( fires >= MAX_FIRES )) && { log "max resumes reached, exiting"; exit 0; }
done
