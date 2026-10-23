// @vitest-environment jsdom
/**
 * Voice capture: the learner decides when a turn ends.
 *
 * These tests exist because of a specific failure on the filmed surface. `continuous`
 * was `false`, so Chromium's own voice-activity detector closed the session at the first
 * pause and `onend` submitted whatever had been caught: Sala cut Dylan off mid-sentence
 * and sent a fragment as his turn. So the contracts pinned here are the negative ones —
 * a final segment is NOT a commit, a browser-side end is NOT a commit, and only
 * `handle.stop()` — the mic button the learner presses — is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startStt, sttSupported, localeFor, type SttCallbacks } from "./stt";

interface Segment {
  transcript: string;
  isFinal: boolean;
}

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  startCalls = 0;
  stopCalls = 0;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start(): void {
    this.startCalls++;
  }
  stop(): void {
    this.stopCalls++;
  }
  abort(): void {}

  /** What the ASR does when it hears speech: one result per segment, final or not. */
  hear(...segments: Segment[]): void {
    const results = segments.map((s) => ({
      isFinal: s.isFinal,
      0: { transcript: s.transcript },
      length: 1,
    }));
    Object.assign(results, { length: segments.length });
    this.onresult?.({ resultIndex: 0, results });
  }
  /** The recognizer closed itself (silence detection, service hiccup). */
  selfEnd(): void {
    this.onend?.();
  }
  failWith(error: string): void {
    this.onerror?.({ error });
  }
}

let cb: SttCallbacks & { onInterim: ReturnType<typeof vi.fn>; onFinal: ReturnType<typeof vi.fn>; onFail: ReturnType<typeof vi.fn>; onEmpty: ReturnType<typeof vi.fn> };
const last = () => FakeRecognition.instances.at(-1)!;

beforeEach(() => {
  FakeRecognition.instances = [];
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
  cb = {
    onInterim: vi.fn(),
    onFinal: vi.fn(),
    onFail: vi.fn(),
    onEmpty: vi.fn(),
  };
});

afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  vi.unstubAllGlobals();
});

describe("startStt — streaming, and the learner owns the commit", () => {
  it("asks the browser for continuous capture, so a pause is not an end of turn", () => {
    startStt(localeFor("en"), cb);
    const rec = last();
    // This single flag was the bug: false = the browser's VAD decides when you stopped.
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);
    expect(rec.maxAlternatives).toBe(1);
    expect(rec.startCalls).toBe(1);
  });

  it("streams interim words without ever submitting them", () => {
    startStt(localeFor("en"), cb);
    last().hear({ transcript: "Yesterday I went to the", isFinal: false });
    expect(cb.onInterim).toHaveBeenCalledWith("Yesterday I went to the");
    expect(cb.onFinal).not.toHaveBeenCalled();
  });

  it("a FINAL segment is still not a turn — only pressing stop is", () => {
    startStt(localeFor("en"), cb);
    last().hear({ transcript: "Yesterday I went to the climbing wall", isFinal: true });
    expect(cb.onFinal).not.toHaveBeenCalled();
    expect(cb.onInterim).toHaveBeenCalledWith("Yesterday I went to the climbing wall");
  });

  it("keeps listening through a pause and grows one transcript across segments", () => {
    const handle = startStt(localeFor("en"), cb)!;
    last().hear({ transcript: "I went to the climbing wall", isFinal: true });
    // Chromium gave up on its own mid-thought. Not the learner's decision → keep going.
    last().selfEnd();
    expect(cb.onFinal).not.toHaveBeenCalled();
    expect(last().startCalls).toBe(2); // relaunched, not restarted-from-scratch

    last().hear({ transcript: "with my friend Daniel", isFinal: true });
    handle.stop();
    last().selfEnd();
    // Both halves of the sentence arrive as ONE turn, in order.
    expect(cb.onFinal).toHaveBeenCalledWith("I went to the climbing wall with my friend Daniel");
  });

  it("does not throw away the word you were still saying when you press stop", () => {
    const handle = startStt(localeFor("en"), cb)!;
    last().hear({ transcript: "I have an interview on", isFinal: true });
    last().hear({ transcript: "Monday", isFinal: false }); // never became final — the ASR was mid-word
    handle.stop();
    last().selfEnd();
    expect(cb.onFinal).toHaveBeenCalledWith("I have an interview on Monday");
  });

  it("stop with nothing heard is an empty turn, not a fabricated one", () => {
    const handle = startStt(localeFor("en"), cb)!;
    handle.stop();
    last().selfEnd();
    expect(cb.onFinal).not.toHaveBeenCalled();
    expect(cb.onEmpty).toHaveBeenCalledTimes(1);
  });

  it("stop() is what closes the capture, and it closes exactly once", () => {
    const handle = startStt(localeFor("en"), cb)!;
    last().hear({ transcript: "Bonjour", isFinal: true });
    handle.stop();
    expect(last().stopCalls).toBe(1);
    last().selfEnd();
    last().selfEnd(); // a browser that fires onend twice must not send twice
    expect(cb.onFinal).toHaveBeenCalledTimes(1);
  });

  it("an 'aborted' error after the learner pressed stop is teardown noise, not a failure", () => {
    const handle = startStt(localeFor("en"), cb)!;
    last().hear({ transcript: "That's all", isFinal: true });
    handle.stop();
    last().failWith("aborted");
    expect(cb.onFail).not.toHaveBeenCalled();
    last().selfEnd();
    expect(cb.onFinal).toHaveBeenCalledWith("That's all");
  });

  it("a real failure says so once and never commits", () => {
    startStt(localeFor("fr"), cb);
    expect(last().lang).toBe("fr-FR");
    last().failWith("not-allowed");
    expect(cb.onFail).toHaveBeenCalledWith("Microphone permission denied — text chat still works.");
    expect(cb.onFinal).not.toHaveBeenCalled();
    last().selfEnd(); // the end that follows an error must not smuggle a commit in
    expect(cb.onFinal).not.toHaveBeenCalled();
    expect(cb.onEmpty).not.toHaveBeenCalled();
  });

  it("'no-speech' is silence, not an error", () => {
    startStt(localeFor("en"), cb);
    last().failWith("no-speech");
    expect(cb.onFail).not.toHaveBeenCalled();
  });

  it("gives up honestly when the browser keeps dropping the session", () => {
    startStt(localeFor("en"), cb);
    // MAX_AUTO_RESTARTS is 5; the 6th self-end has to stop the loop rather than spin.
    for (let i = 0; i < 6; i++) last().selfEnd();
    expect(last().startCalls).toBe(6); // 1 start + 5 relaunches, then it stops pretending
    expect(cb.onFail).toHaveBeenCalledWith(
      "Speech capture kept dropping out in this browser — text chat still works.",
    );
    expect(cb.onFinal).not.toHaveBeenCalled();
  });

  it("keeps what it actually heard when the dropouts force a close", () => {
    startStt(localeFor("en"), cb);
    last().hear({ transcript: "I need to practise my presentation", isFinal: true });
    for (let i = 0; i < 6; i++) last().selfEnd();
    expect(cb.onFinal).toHaveBeenCalledWith("I need to practise my presentation");
    expect(cb.onFail).not.toHaveBeenCalled();
  });
});

describe("feature detection", () => {
  it("a browser with no Web Speech API fails loudly and hands off to text", () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    expect(sttSupported()).toBe(false);
    expect(startStt(localeFor("en"), cb)).toBeNull();
    expect(cb.onFail).toHaveBeenCalledWith("This browser has no Web Speech API — text chat still works.");
    expect(cb.onFinal).not.toHaveBeenCalled();
  });
});
