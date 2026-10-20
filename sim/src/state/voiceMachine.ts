/**
 * Half-duplex turn-taking state machine (voice mode).
 *
 * TTS-gated mic: the mic can only be armed from `idle`, and re-arms only after
 * TTS finishes (speaking → TTS_DONE → idle). No barge-in, no echo path.
 * Pure logic — unit-tested; actual audio lives in sim/src/voice/*.
 *
 *   idle --MIC_ON--> listening --STT_FINAL--> thinking --REPLY_READY--> speaking
 *     ^                   |                      |                        |
 *     +------MIC_OFF------+                      +--CHAT_ERROR-------     |
 *     ^                   |                                               |
 *     +------STT_FAIL-----+        speaking --TTS_DONE / TTS_UNAVAILABLE--+
 */
export type VoiceState = "idle" | "listening" | "thinking" | "speaking";

export type VoiceEvent =
  | { type: "MIC_ON" }
  | { type: "MIC_OFF" }
  | { type: "STT_FINAL" }
  | { type: "STT_FAIL" }
  | { type: "REPLY_READY" }
  | { type: "CHAT_ERROR" }
  | { type: "TTS_DONE" }
  | { type: "TTS_UNAVAILABLE" };

export function voiceNext(state: VoiceState, event: VoiceEvent): VoiceState {
  switch (state) {
    case "idle":
      return event.type === "MIC_ON" ? "listening" : state;
    case "listening":
      if (event.type === "MIC_OFF") return "idle";
      if (event.type === "STT_FINAL") return "thinking";
      if (event.type === "STT_FAIL") return "idle";
      return state;
    case "thinking":
      if (event.type === "REPLY_READY") return "speaking";
      if (event.type === "CHAT_ERROR") return "idle";
      return state;
    case "speaking":
      // TTS_DONE = utterance finished; TTS_UNAVAILABLE = speak() found no
      // backend at all (arrives right after REPLY_READY) — either way the
      // gate reopens and the reply stays readable on screen.
      if (event.type === "TTS_DONE" || event.type === "TTS_UNAVAILABLE") return "idle";
      return state;
  }
}

/**
 * Mic is armed ONLY from idle with STT present and no chat in flight —
 * the TTS gate (mic stays dead through thinking + speaking).
 */
export function micEnabled(state: VoiceState, sttSupported: boolean, chatBusy: boolean): boolean {
  return sttSupported && !chatBusy && state === "idle";
}
