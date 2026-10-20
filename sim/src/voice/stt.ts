/**
 * STT via the browser Web Speech API (webkitSpeechRecognition).
 * Feature-detected: when unavailable (Firefox/Safari), the sim degrades to the
 * text input with an honest notice — the text path always works.
 *
 * NOTE: this simulates Alexa+'s DEVICE-SIDE ASR. A real Alexa+ add-on never
 * receives audio — it receives text over MCP (see SPEC "Real-Alexa+ mapping").
 */

interface SRAlternative { transcript: string }
interface SRResult { isFinal: boolean; 0: SRAlternative; length: number }
interface SRResultList { length: number; [i: number]: SRResult }
interface SREvent { resultIndex: number; results: SRResultList }
interface SRErrorEvent { error?: string }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type SRConstructor = new () => SpeechRecognitionLike;

function srConstructor(): SRConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRConstructor; webkitSpeechRecognition?: SRConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function sttSupported(): boolean {
  return srConstructor() !== null;
}

/** Web Speech BCP-47 locale per target language (demo languages only). */
export function localeFor(lang: string): string {
  switch (lang) {
    case "de":
      return "de-DE";
    case "fr":
      return "fr-FR";
    default:
      return "en-US";
  }
}

export interface SttCallbacks {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  /** hard failure (permission denied, service unreachable…) */
  onFail: (message: string) => void;
  /** recognition ended with no final transcript (silence / manual stop) */
  onEmpty: () => void;
}

export interface SttHandle {
  stop: () => void;
}

const FAIL_MESSAGES: Record<string, string> = {
  "not-allowed": "Microphone permission denied — text chat still works.",
  "service-not-allowed": "Speech service blocked by the browser — text chat still works.",
  "audio-capture": "No microphone found — text chat still works.",
  network: "Speech recognition service unreachable (browser ASR needs its cloud service) — text chat still works.",
  aborted: "Recognition aborted — text chat still works.",
};

export function startStt(locale: string, cb: SttCallbacks): SttHandle | null {
  const Ctor = srConstructor();
  if (!Ctor) {
    cb.onFail("This browser has no Web Speech API — text chat still works.");
    return null;
  }
  const rec = new Ctor();
  rec.lang = locale;
  rec.continuous = false; // auto-stops on silence
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let finalText = "";
  let settled = false;

  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const t = r[0]?.transcript ?? "";
      if (r.isFinal) finalText += t;
      else interim += t;
    }
    if (interim) cb.onInterim(interim);
    if (finalText && !settled) {
      settled = true;
      cb.onFinal(finalText.trim());
    }
  };
  rec.onerror = (e) => {
    const code = e.error ?? "unknown";
    // 'no-speech' is not an error state for us — onend decides.
    if (code === "no-speech") return;
    if (!settled) {
      settled = true;
      cb.onFail(FAIL_MESSAGES[code] ?? `Speech recognition failed (${code}) — text chat still works.`);
    }
  };
  rec.onend = () => {
    if (settled) return;
    settled = true;
    if (finalText.trim()) cb.onFinal(finalText.trim());
    else cb.onEmpty();
  };

  try {
    rec.start();
  } catch {
    if (!settled) {
      settled = true;
      cb.onFail("Could not start speech recognition — text chat still works.");
    }
    return null;
  }
  return { stop: () => rec.stop() };
}
