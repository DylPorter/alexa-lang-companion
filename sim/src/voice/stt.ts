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
  /**
   * Live transcript while the learner is talking: every segment committed so far plus
   * the one in flight. Fired repeatedly — this is the streaming surface the pane shows
   * as a growing user bubble.
   */
  onInterim: (text: string) => void;
  /**
   * The turn, finalised. Fired ONCE, and only after the learner stopped the mic — never
   * because the browser's own silence detector ended the session. That distinction is
   * the whole point: `continuous = false` used to let the browser decide when the
   * learner had finished speaking, which cut them off and submitted the fragment.
   */
  onFinal: (text: string) => void;
  /** hard failure (permission denied, service unreachable…) */
  onFail: (message: string) => void;
  /** the learner stopped the mic and nothing was heard */
  onEmpty: () => void;
}

export interface SttHandle {
  /** The learner's "that's all": commit what was heard and release the mic. */
  stop: () => void;
}

const FAIL_MESSAGES: Record<string, string> = {
  "not-allowed": "Microphone permission denied — text chat still works.",
  "service-not-allowed": "Speech service blocked by the browser — text chat still works.",
  "audio-capture": "No microphone found — text chat still works.",
  network: "Speech recognition service unreachable (browser ASR needs its cloud service) — text chat still works.",
  aborted: "Recognition aborted — text chat still works.",
};

/**
 * Chromium ends a continuous session by itself after a long enough gap. Relaunching is
 * invisible and the transcript keeps growing, so a pause mid-sentence costs nothing. The
 * cap exists so a muted mic or a broken service cannot spin forever: past it we say what
 * happened rather than keep pretending to listen.
 */
const MAX_AUTO_RESTARTS = 5;

export function startStt(locale: string, cb: SttCallbacks): SttHandle | null {
  const Ctor = srConstructor();
  if (!Ctor) {
    cb.onFail("This browser has no Web Speech API — text chat still works.");
    return null;
  }

  // Assigned by `begin()` before anything can read it; the handlers close over this.
  let rec!: SpeechRecognitionLike;
  /** Final segments so far, joined. Survives a relaunch, so one turn can span several. */
  let heard = "";
  /** The in-flight segment. Kept so stopping the mic mid-word does not throw it away. */
  let pending = "";
  let settled = false;
  let userStopped = false;
  let restarts = 0;

  const joined = () => `${heard}${heard && pending ? " " : ""}${pending}`.trim();

  const settle = () => {
    if (settled) return;
    settled = true;
    const text = joined();
    if (text) cb.onFinal(text);
    else cb.onEmpty();
  };

  const fail = (message: string) => {
    if (settled) return;
    settled = true;
    cb.onFail(message);
  };

  const begin = () => {
    rec = new Ctor();
    rec.lang = locale;
    rec.continuous = true; // the learner stops talking; the browser does not decide that
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = (e.results[i]?.[0]?.transcript ?? "").trim();
        if (!t) continue;
        if (e.results[i]?.isFinal) {
          heard = `${heard} ${t}`.trim();
          pending = "";
        } else {
          pending = t;
        }
      }
      const text = joined();
      // No commit here, ever. Streaming text is not a turn the learner agreed to.
      if (text) cb.onInterim(text);
    };

    rec.onerror = (e) => {
      const code = e.error ?? "unknown";
      // 'no-speech' is not a failure — onend decides what happens next.
      if (code === "no-speech") return;
      // 'aborted' right after the learner pressed stop is our own teardown talking; let
      // onend deliver the transcript instead of showing a failure over a valid turn.
      if (code === "aborted" && userStopped) return;
      fail(FAIL_MESSAGES[code] ?? `Speech recognition failed (${code}) — text chat still works.`);
    };

    rec.onend = () => {
      if (settled) return;
      if (userStopped) {
        settle();
        return;
      }
      if (restarts >= MAX_AUTO_RESTARTS) {
        // Give up honestly: keep what was actually heard, or report the dropout.
        if (joined()) settle();
        else fail("Speech capture kept dropping out in this browser — text chat still works.");
        return;
      }
      restarts++;
      try {
        rec.start();
      } catch {
        // Throws if the previous session has not released the mic yet. Not a failure:
        // the next onend, or the learner's stop, is what we are waiting on.
      }
    };
  };

  try {
    begin();
    rec.start();
  } catch {
    fail("Could not start speech recognition — text chat still works.");
    return null;
  }

  return {
    stop: () => {
      userStopped = true;
      rec.stop(); // → onend → settle()
    },
  };
}
