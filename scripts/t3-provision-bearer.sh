#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/tts-dir.sh
source "$SCRIPT_DIR/lib/tts-dir.sh"

runtime_path="$HOME/.t3/userdata/server-runtime.json"
secrets_dir="$TTS_DIR/secrets"
bearer_path="$secrets_dir/t3-bearer"
auth_rev_path="$TTS_DIR/.t3-auth-rev"
bootstrap_file=""
bearer_tmp=""
admin_sid=""

fail() {
  printf 't3-provision-bearer: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  if [[ -n "${admin_sid:-}" && -n "${t3_bin:-}" && -n "${server_cli:-}" ]]; then
    ELECTRON_RUN_AS_NODE=1 "$t3_bin" "$server_cli" \
      auth session revoke "$admin_sid" --base-dir "$HOME/.t3" >/dev/null 2>&1 || true
  fi
  if [[ -n "${bootstrap_file:-}" && -f "$bootstrap_file" ]]; then
    rm -f "$bootstrap_file" || true
  fi
  if [[ -n "${bearer_tmp:-}" && -f "$bearer_tmp" ]]; then
    rm -f "$bearer_tmp" || true
  fi
  admin_sid=""
  bootstrap_file=""
  bearer_tmp=""
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

for command in node lsof ps mktemp stat; do
  command -v "$command" >/dev/null 2>&1 || fail "required tool is unavailable"
done
[[ -f "$runtime_path" ]] || fail "T3 server runtime descriptor is unavailable"

server_pid="$(node -e '
  const fs = require("fs");
  try {
    const runtime = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const pid = runtime.pid ?? runtime.serverPid;
    if (!Number.isSafeInteger(pid) || pid <= 1) process.exit(1);
    process.stdout.write(String(pid));
  } catch { process.exit(1); }
' "$runtime_path")" || fail "T3 server runtime descriptor is invalid"
ps -p "$server_pid" -o pid= >/dev/null 2>&1 || fail "T3 server process is not running"

# Resolve the bundle owning the running server. The installed channel/name is
# intentionally not assumed (stable, nightly, and future builds all work).
app_path="$({
  lsof -a -p "$server_pid" -Fn 2>/dev/null || true
  ps -p "$server_pid" -o command= 2>/dev/null || true
} | node -e '
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => { input += chunk; });
  process.stdin.on("end", () => {
    const match = input.match(/(\/[^\n]*?\.app)(?=\/Contents\/)/);
    if (match) process.stdout.write(match[1]);
  });
')"
[[ -n "$app_path" && -d "$app_path/Contents" ]] || fail "could not resolve the running T3 app bundle"
app_path="$(cd "$app_path" && pwd -P)"

t3_bin=""
for candidate in "$app_path"/Contents/MacOS/*; do
  if [[ -f "$candidate" && -x "$candidate" ]]; then
    t3_bin="$candidate"
    break
  fi
done
[[ -n "$t3_bin" ]] || fail "T3 app executable is unavailable"
server_cli="$app_path/Contents/Resources/app.asar/apps/server/dist/bin.mjs"
[[ -f "$app_path/Contents/Resources/app.asar" ]] || fail "T3 application archive is unavailable"

if [[ -e "$secrets_dir" || -L "$secrets_dir" ]]; then
  [[ -d "$secrets_dir" && ! -L "$secrets_dir" ]] || fail "secrets path is unsafe"
else
  mkdir -m 700 "$secrets_dir" || fail "could not create secrets directory"
fi
[[ "$(stat -f '%u' "$secrets_dir")" == "$(id -u)" ]] || fail "secrets directory owner is unsafe"
[[ "$(stat -f '%Lp' "$secrets_dir")" == "700" ]] || fail "secrets directory permissions are unsafe"

if [[ -e "$bearer_path" || -L "$bearer_path" ]]; then
  [[ -f "$bearer_path" && ! -L "$bearer_path" ]] || fail "existing bearer path is unsafe"
  [[ "$(stat -f '%u' "$bearer_path")" == "$(id -u)" ]] || fail "existing bearer owner is unsafe"
  [[ "$(stat -f '%Lp' "$bearer_path")" == "600" ]] || fail "existing bearer permissions are unsafe"
fi

bootstrap_file="$(mktemp "${TMPDIR:-/tmp}/room-t3-bootstrap.XXXXXX")"
bearer_tmp="$secrets_dir/.t3-bearer.$$.${RANDOM}${RANDOM}"
chmod 600 "$bootstrap_file"

# The short-lived admin token exists only in this restricted temp file and in
# the child processes' stdin/memory. CLI diagnostics are suppressed so a
# future upstream error cannot accidentally reproduce credentials in logs.
if ! ELECTRON_RUN_AS_NODE=1 "$t3_bin" "$server_cli" \
  auth session issue \
  --base-dir "$HOME/.t3" \
  --subject room-of-devs-daemon \
  --label "Room of Devs (bootstrap)" \
  --ttl 5m \
  --token-only \
  --json 2>/dev/null | node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => { input += chunk; });
    process.stdin.on("end", () => {
      try {
        const value = JSON.parse(input);
        const token = value.token ?? value.accessToken;
        const sid = value.sid ?? value.sessionId;
        if (typeof token !== "string" || !token ||
            typeof sid !== "string" || !/^[0-9a-f-]{36}$/i.test(sid)) process.exit(1);
        process.stdout.write(JSON.stringify({ token, sid }));
      } catch { process.exit(1); }
    });
  ' >"$bootstrap_file"; then
  fail "temporary admin session issuance failed"
fi

admin_sid="$(node -e '
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => { input += chunk; });
  process.stdin.on("end", () => {
    try {
      const value = JSON.parse(input);
      const sid = value.sid;
      if (typeof sid !== "string" || !/^[0-9a-f-]{36}$/i.test(sid)) process.exit(1);
      process.stdout.write(sid);
    } catch { process.exit(1); }
  });
' <"$bootstrap_file")" || fail "temporary admin session response was invalid"

# One stdin-fed Node process keeps the admin token and one-time pairing
# credential in memory, validates the loopback origin, delegates exactly two
# scopes, and writes the restricted bearer to an O_EXCL temp file.
if ! node -e '
  const fs = require("fs");
  const net = require("net");

  function originFor(raw) {
    try {
      const url = new URL(raw);
      if (url.protocol !== "http:" || url.username || url.password ||
          url.pathname !== "/" || url.search || url.hash) return null;
      const host = url.hostname.replace(/^\[|\]$/g, "");
      const family = net.isIP(host);
      if (family === 4 && host.split(".")[0] === "127") return url.origin;
      if (family === 6 && host === "::1") return url.origin;
      return null;
    } catch { return null; }
  }

  async function main() {
    let input = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) input += chunk;
    const bootstrap = JSON.parse(input);
    const adminToken = bootstrap.token ?? bootstrap.accessToken;
    if (typeof adminToken !== "string" || !adminToken) throw new Error();
    const runtime = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const origin = originFor(runtime.origin);
    if (!origin) throw new Error();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const pairingResponse = await fetch(`${origin}/api/auth/pairing-token`, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          label: "Room of Devs daemon",
          scopes: ["orchestration:read", "orchestration:operate"],
        }),
      });
      if (!pairingResponse.ok) throw new Error();
      const pairing = await pairingResponse.json();
      if (typeof pairing.credential !== "string" || !pairing.credential) throw new Error();

      const form = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: pairing.credential,
        subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap",
        requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
        scope: "orchestration:read orchestration:operate",
      });
      const tokenResponse = await fetch(`${origin}/oauth/token`, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      if (!tokenResponse.ok) throw new Error();
      const token = await tokenResponse.json();
      const grantedScopes = typeof token.scope === "string"
        ? token.scope.trim().split(/\s+/).sort().join(" ")
        : "";
      if (grantedScopes !== "orchestration:operate orchestration:read" ||
          typeof token.access_token !== "string" || !token.access_token) throw new Error();
      fs.writeFileSync(process.argv[2], token.access_token, { flag: "wx", mode: 0o600 });
    } finally {
      clearTimeout(timer);
    }
  }

  main().catch(() => {
    process.stderr.write("T3 credential exchange failed\n");
    process.exitCode = 1;
  });
' "$runtime_path" "$bearer_tmp" <"$bootstrap_file" >/dev/null 2>&1; then
  fail "restricted bearer delegation failed"
fi
[[ -s "$bearer_tmp" ]] || fail "restricted bearer delegation returned no credential"

# Revocation is the commit gate: no steady-state bearer is installed while
# the bootstrap admin session remains active. Its 5m TTL is only a fallback.
if ! ELECTRON_RUN_AS_NODE=1 "$t3_bin" "$server_cli" \
  auth session revoke "$admin_sid" --base-dir "$HOME/.t3" >/dev/null 2>&1; then
  fail "temporary admin session revocation failed; bearer was not installed"
fi
rm -f "$bootstrap_file"
bootstrap_file=""
admin_sid=""

chmod 600 "$bearer_tmp"
mv -f "$bearer_tmp" "$bearer_path"
bearer_tmp=""
[[ -f "$bearer_path" && ! -L "$bearer_path" ]] || fail "installed bearer path is unsafe"
[[ "$(stat -f '%u' "$bearer_path")" == "$(id -u)" ]] || fail "installed bearer owner is unsafe"
[[ "$(stat -f '%Lp' "$bearer_path")" == "600" ]] || fail "installed bearer permissions are unsafe"

touch "$auth_rev_path"
printf 'T3 reply bearer provisioned.\n'
