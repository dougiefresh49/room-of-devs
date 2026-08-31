/**
 * Reply deck — typed chat + attachments + PTT bar + grant chip.
 * Board ~L1488. Target session = open node (or sole injectable).
 */
import { useEffect, useRef, useState } from "react";
import type { AgentView } from "@room/protocol";
import { Chassis, Keycap, ScreenBed, Waveform } from "@room/ui";
import { PENDING_GRANT_MS } from "@room/room-client";
import { client } from "../../client.js";
import { platform } from "../../platform/tauri.js";
import { runCommand } from "../commands.js";
import { grantPendingFor, latestCrossRealmPending } from "../grant-guard.js";
import { showErrorToast } from "../view-state.js";
import { usePttGrant } from "../usePttGrant.js";

interface Attachment {
  id: string;
  name: string;
  path: string;
}

interface ReplyDeckProps {
  target: AgentView | null;
  connected: boolean;
}

export function ReplyDeck({ target, connected }: ReplyDeckProps) {
  const sessionId = target?.sessionId ?? "";
  const ptt = usePttGrant(sessionId || "__none__", connected && !!target);
  const [holding, setHolding] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const draft = sessionId ? (drafts[sessionId] ?? "") : "";

  const pendingSid = latestCrossRealmPending();
  const pending =
    !!target && (grantPendingFor(client, target.sessionId) || pendingSid === target.sessionId);
  const [grantLeft, setGrantLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!pending) {
      setGrantLeft(null);
      return;
    }
    const tick = () => {
      try {
        const key = `room_grant_pending:${pendingSid ?? target?.sessionId ?? ""}`;
        const raw = localStorage.getItem(key);
        const at = raw ? Number(raw) : NaN;
        if (!Number.isFinite(at)) {
          setGrantLeft(Math.ceil(PENDING_GRANT_MS / 1000));
          return;
        }
        const left = Math.max(0, Math.ceil((PENDING_GRANT_MS - (Date.now() - at)) / 1000));
        setGrantLeft(left);
      } catch {
        setGrantLeft(null);
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [pending, pendingSid, target?.sessionId]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta || !sessionId) return;
    ta.value = drafts[sessionId] ?? "";
    autoGrow(ta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const disabled = !target || !connected || !target.injectable || sending;
  const callsign = (target?.label ?? target?.name ?? "—").toUpperCase();
  const hasPayload = !!(draft.trim() || attachments.length);

  const submit = async () => {
    if (!target || disabled) return;
    const ta = taRef.current;
    const text = (ta?.value ?? draft).trim();
    const attachLines = attachments.map((a) => `[attached file: ${a.path}]`);
    const body = [text, ...attachLines].filter(Boolean).join("\n").trim();
    if (!body) return;
    setSending(true);
    try {
      const ok = await runCommand(
        { type: "reply", sessionId: target.sessionId, text: body },
        "Couldn't send reply",
      );
      if (ok) {
        if (ta) ta.value = "";
        setDrafts((d) => ({ ...d, [target.sessionId]: "" }));
        setAttachments([]);
        autoGrow(ta);
      }
    } finally {
      setSending(false);
    }
  };

  const addFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const path = await platform.saveAttachment(file.name || "file.bin", buf);
        setAttachments((prev) => [
          ...prev,
          { id: `${Date.now()}-${file.name}`, name: file.name || "file", path },
        ]);
      } catch (err) {
        console.error(err);
        showErrorToast("Couldn't save attachment");
      }
    }
  };

  return (
    <Chassis className="console-reply" screws>
      <div className="console-reply-bound">
        {target ? `REPLY // ${callsign} · TMUX INJECT` : "OPEN A NODE TO REPLY"}
      </div>

      {attachments.length ? (
        <div className="console-attach-chips">
          {attachments.map((a) => (
            <span key={a.id} className="console-attach-chip">
              {a.name}
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="console-composer-row">
        <div
          className="console-composer-field"
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
          }}
        >
          <ScreenBed>
            <textarea
              ref={taRef}
              rows={1}
              placeholder={
                target
                  ? "Type a reply — paste or drop files to attach"
                  : "Open an injectable node to reply"
              }
              disabled={disabled}
              defaultValue={draft}
              onInput={(e) => {
                if (!sessionId) return;
                const v = e.currentTarget.value;
                setDrafts((d) => ({ ...d, [sessionId]: v }));
                autoGrow(e.currentTarget);
              }}
              onPaste={(e) => {
                const files = e.clipboardData?.files;
                if (files && files.length) {
                  e.preventDefault();
                  void addFiles(files);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
          </ScreenBed>
        </div>
        <Keycap
          glyph="⏎"
          label="INJECT"
          armed={!disabled && hasPayload}
          onPress={() => {
            void submit();
          }}
        />
      </div>

      {target ? (
        <div
          className={`console-pttbar${holding ? " hot" : ""} no-drag`}
          role="button"
          tabIndex={connected ? 0 : -1}
          aria-label="Push to talk"
          {...ptt.gesture}
          onMouseDown={(e) => {
            setHolding(true);
            ptt.gesture.onMouseDown(e);
          }}
          onMouseUp={(e) => {
            setHolding(false);
            ptt.gesture.onMouseUp(e);
          }}
          onMouseLeave={(e) => {
            setHolding(false);
            ptt.gesture.onMouseLeave(e);
          }}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") setHolding(true);
            ptt.gesture.onKeyDown(e);
          }}
          onKeyUp={(e) => {
            setHolding(false);
            ptt.gesture.onKeyUp(e);
          }}
        >
          <span className="console-ptt-btn" aria-hidden />
          <span className="console-ptt-lbl">
            {holding ? (
              <>
                <b>CAPTURING — RELEASE TO SEND</b>
                <br />
                HOLD SPACE OR HW KEY
              </>
            ) : (
              <>
                <b>MIC COLD</b>
                <br />
                HOLD TO TALK
              </>
            )}
          </span>
          {holding ? (
            <div style={{ marginLeft: "auto" }}>
              <Waveform active />
            </div>
          ) : null}
        </div>
      ) : null}

      {pending && grantLeft != null ? (
        <div className="console-grantchip">
          <span className="gl" />
          SPEAKER GRANT ARMED · {formatCountdown(grantLeft)} LEFT — DAEMON CLAIM MARKERS STAY THE
          BILLING AUTHORITY
        </div>
      ) : null}
    </Chassis>
  );
}

function autoGrow(ta: HTMLTextAreaElement | null) {
  if (!ta) return;
  ta.style.height = "auto";
  ta.style.height = `${Math.min(ta.scrollHeight, 112)}px`;
}

function formatCountdown(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
