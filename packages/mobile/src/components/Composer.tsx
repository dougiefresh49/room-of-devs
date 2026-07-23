/**
 * Reply composer (spec §B1 input row): a single-line textarea that auto-grows
 * to a max of 4 lines, with an inline circular send button inside one input
 * shell. NO cancel button (v1 failure #2).
 *
 * Wispr-Flow-stable: the textarea is UNCONTROLLED — snapshot re-renders never
 * wipe what's being typed. The parent gives each session its own Composer via
 * `key={sessionId}`, so mounting loads that session's in-memory draft
 * (drafts.ts) and switching sessions resets the field. Enter (no shift) sends;
 * Shift+Enter inserts a newline.
 *
 * `onSend` returns whether the send succeeded — on success the field + draft
 * are cleared; on failure the text stays so the user can retry.
 */
import { useEffect, useRef, useState } from "react";
import { IconSend } from "../icons.js";
import { getDraft, setDraft } from "../drafts.js";

const MAX_HEIGHT = 112; // ~4 lines at the field's line-height + padding

interface ComposerProps {
  sessionId: string;
  placeholder: string;
  onSend: (text: string) => Promise<boolean>;
}

export function Composer({ sessionId, placeholder, onSend }: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  // The sync ref is the race gate (blocks a second dispatch before React
  // re-renders); the reactive flag drives the disabled/visual state. Both are
  // reset in `finally` so a rejecting onSend can't wedge the composer.
  const sending = useRef(false);
  const [isSending, setIsSending] = useState(false);

  const autoGrow = () => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_HEIGHT)}px`;
  };

  // Load this session's draft on mount (Composer is keyed by session).
  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.value = getDraft(sessionId);
    autoGrow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    const ta = ref.current;
    if (!ta || sending.current) return;
    const text = ta.value.trim();
    if (!text) return;
    sending.current = true;
    setIsSending(true);
    try {
      const ok = await onSend(text);
      if (ok) {
        ta.value = "";
        setDraft(sessionId, "");
        autoGrow();
      }
    } finally {
      sending.current = false;
      setIsSending(false);
    }
  };

  return (
    <div className="shrink-0 border-t border-line bg-bg-elevated px-3 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2">
      <div className="flex items-end gap-2 rounded-2xl border border-line-strong bg-surface px-2 py-1.5 focus-within:border-accent">
        <textarea
          ref={ref}
          rows={1}
          placeholder={placeholder}
          disabled={isSending}
          onInput={(e) => {
            setDraft(sessionId, e.currentTarget.value);
            autoGrow();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          className="min-h-[28px] flex-1 resize-none bg-transparent px-1.5 py-1 text-[15px] leading-snug text-fg outline-none placeholder:text-fg-faint disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={isSending}
          aria-disabled={isSending}
          aria-label="Send reply"
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-bg transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-70 [&_svg]:size-[18px]"
        >
          {isSending ? (
            <span className="size-4 animate-spin rounded-full border-2 border-bg/40 border-t-bg" />
          ) : (
            <IconSend />
          )}
        </button>
      </div>
    </div>
  );
}
