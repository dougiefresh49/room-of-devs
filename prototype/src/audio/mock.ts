/**
 * Free canned voice via speechSynthesis.
 * Exposes speaking state for lamps / waveforms / lipsync.
 */

export type SpeakListener = (speaking: boolean, persona: string | null) => void;

let speaking = false;
let persona: string | null = null;
const listeners = new Set<SpeakListener>();

function emit() {
  for (const l of listeners) l(speaking, persona);
}

export function subscribeSpeaking(listener: SpeakListener): () => void {
  listeners.add(listener);
  listener(speaking, persona);
  return () => listeners.delete(listener);
}

export function isSpeaking(): boolean {
  return speaking;
}

export function speakingPersona(): string | null {
  return persona;
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  speaking = false;
  persona = null;
  emit();
}

export function speak(text: string, who = "mikey"): Promise<void> {
  stopSpeaking();
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    speaking = true;
    persona = who;
    emit();
    return new Promise((resolve) => {
      window.setTimeout(() => {
        speaking = false;
        persona = null;
        emit();
        resolve();
      }, Math.min(4000, 400 + text.length * 40));
    });
  }

  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.pitch = who === "donnie" ? 0.85 : 1.05;
    u.onstart = () => {
      speaking = true;
      persona = who;
      emit();
    };
    const done = () => {
      speaking = false;
      persona = null;
      emit();
      resolve();
    };
    u.onend = done;
    u.onerror = done;
    speaking = true;
    persona = who;
    emit();
    window.speechSynthesis.speak(u);
  });
}
