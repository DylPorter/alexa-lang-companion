/**
 * Voice turn-taking state machine tests (pure logic; no audio in CI):
 * half-duplex cycle, TTS-gated mic, failure paths, STT-unavailable gating.
 */
import { describe, expect, it } from "vitest";
import { micEnabled, voiceNext, VoiceState } from "./voiceMachine";

function run(seq: Parameters<typeof voiceNext>[1][], start: VoiceState = "idle"): VoiceState[] {
  const states: VoiceState[] = [start];
  let s = start;
  for (const e of seq) {
    s = voiceNext(s, e);
    states.push(s);
  }
  return states;
}

describe("voiceNext — the half-duplex cycle", () => {
  it("runs idle → listening → thinking → speaking → idle", () => {
    expect(
      run([
        { type: "MIC_ON" },
        { type: "STT_FINAL" },
        { type: "REPLY_READY" },
        { type: "TTS_DONE" },
      ]),
    ).toEqual(["idle", "listening", "thinking", "speaking", "idle"]);
  });

  it("loops a second exchange after TTS finishes (mic re-armed)", () => {
    const states = run([
      { type: "MIC_ON" },
      { type: "STT_FINAL" },
      { type: "REPLY_READY" },
      { type: "TTS_DONE" },
      { type: "MIC_ON" },
    ]);
    expect(states.at(-1)).toBe("listening");
  });
});

describe("voiceNext — interruption + failure paths", () => {
  it("MIC_OFF cancels listening", () => {
    expect(run([{ type: "MIC_ON" }, { type: "MIC_OFF" }]).at(-1)).toBe("idle");
  });

  it("STT_FAIL (permission/network) returns to idle", () => {
    expect(run([{ type: "MIC_ON" }, { type: "STT_FAIL" }]).at(-1)).toBe("idle");
  });

  it("CHAT_ERROR from thinking returns to idle (gate reopens)", () => {
    expect(run([{ type: "MIC_ON" }, { type: "STT_FINAL" }, { type: "CHAT_ERROR" }]).at(-1)).toBe("idle");
  });

  it("TTS_UNAVAILABLE (no voices, no piper) returns to idle — reply stays on screen", () => {
    expect(
      run([{ type: "MIC_ON" }, { type: "STT_FINAL" }, { type: "REPLY_READY" }, { type: "TTS_UNAVAILABLE" }]).at(-1),
    ).toBe("idle");
  });

  it("ignores out-of-band events (no impossible states)", () => {
    expect(voiceNext("idle", { type: "TTS_DONE" })).toBe("idle");
    expect(voiceNext("idle", { type: "STT_FINAL" })).toBe("idle");
    expect(voiceNext("listening", { type: "REPLY_READY" })).toBe("listening");
    expect(voiceNext("thinking", { type: "MIC_ON" })).toBe("thinking");
    expect(voiceNext("speaking", { type: "MIC_ON" })).toBe("speaking"); // no barge-in
    expect(voiceNext("speaking", { type: "STT_FINAL" })).toBe("speaking");
  });
});

describe("micEnabled — the TTS gate", () => {
  it("arms only from idle with STT present and no chat in flight", () => {
    expect(micEnabled("idle", true, false)).toBe(true);
    expect(micEnabled("listening", true, false)).toBe(false);
    expect(micEnabled("thinking", true, false)).toBe(false);
    expect(micEnabled("speaking", true, false)).toBe(false); // TTS gate
    expect(micEnabled("idle", false, false)).toBe(false); // STT unavailable → text-only
    expect(micEnabled("idle", true, true)).toBe(false); // chat in flight
  });
});
