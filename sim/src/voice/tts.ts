/**
 * speak() — one interface, two honest backends:
 *   1. window.speechSynthesis with a voice matching the target language
 *      (preferred; natural voices on Chrome/Edge/macOS),
 *   2. a LOCAL Piper TTS server (scripts/piper-tts-server.mjs) for machines
 *      where the browser exposes no voices at all (Linux/Chromium headless).
 * If neither exists: onUnavailable — the reply stays on screen, nothing is
 * faked as spoken.
 *
 * Like stt.ts: this simulates Alexa+'s DEVICE-SIDE TTS. The MCP server only
 * ever sees text — exactly like a real Alexa+ add-on.
 */

export interface SpeakHooks {
  onStart: (backend: TtsBackend) => void;
  onEnd: () => void;
  onUnavailable: (reason: string) => void;
}

export interface TtsBackend {
  kind: "browser" | "piper";
  /** human-readable voice actually used, for the honesty footer */
  voiceLabel: string;
}

export const DEFAULT_PIPER_URL = "http://127.0.0.1:5055/tts";

const PREFERRED_VOICE = /google|natural|neural|premium|online/i;

export function browserVoiceFor(lang: string): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  const base = lang.toLowerCase();
  const matching = voices.filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith(base));
  if (matching.length === 0) return null;
  return matching.find((v) => PREFERRED_VOICE.test(v.name)) ?? matching[0];
}

let currentAudio: HTMLAudioElement | null = null;

/** Cancel any in-flight speech (session end / language switch). */
export function cancelSpeech(): void {
  if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

export async function speak(
  text: string,
  lang: string,
  hooks: SpeakHooks,
  piperUrl: string = DEFAULT_PIPER_URL,
): Promise<TtsBackend | null> {
  const voice = browserVoiceFor(lang);
  if (voice && typeof window !== "undefined" && window.speechSynthesis) {
    const backend: TtsBackend = { kind: "browser", voiceLabel: `${voice.name} (${voice.lang})` };
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.onend = () => hooks.onEnd();
    u.onerror = () => hooks.onEnd(); // treat failures as done so the gate reopens
    hooks.onStart(backend);
    window.speechSynthesis.speak(u);
    return backend;
  }

  // Piper fallback — local neural TTS behind the same interface.
  try {
    const res = await fetch(`${piperUrl}?lang=${encodeURIComponent(lang)}&text=${encodeURIComponent(text)}`);
    if (!res.ok) throw new Error(`piper HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    const backend: TtsBackend = { kind: "piper", voiceLabel: "local Piper TTS (neural)" };
    audio.onended = () => {
      currentAudio = null;
      URL.revokeObjectURL(url);
      hooks.onEnd();
    };
    audio.onerror = () => {
      currentAudio = null;
      URL.revokeObjectURL(url);
      hooks.onEnd();
    };
    hooks.onStart(backend);
    await audio.play();
    return backend;
  } catch {
    hooks.onUnavailable(
      "No speech voices in this browser and no local Piper TTS server — the reply is on screen only.",
    );
    return null;
  }
}
