/**
 * Pure conversation-state tests: sessionId pass-through (the A1 contract —
 * pass it back every turn), remembered-badge sourcing, END_SESSION semantics.
 */
import { describe, expect, it } from "vitest";
import { chatRequestArgs, convReducer, initialConv } from "./conversation";
import type { ChatResult } from "../mcp/types";

function reply(partial: Partial<ChatResult> = {}): ChatResult {
  return {
    reply: "Hello!",
    sessionId: "s-1",
    memoryReferenced: false,
    isNewSession: true,
    language: "en",
    languageName: "English",
    languageChanged: false,
    // Required because the server always sends it; [] = nothing was handed to ask about.
    followUps: [],
    ...partial,
  };
}

describe("chatRequestArgs — sessionId pass-through", () => {
  it("omits sessionId before the first reply", () => {
    const args = chatRequestArgs({ sessionId: null }, "hi", "fr");
    expect(args).toEqual({ message: "hi", targetLanguage: "fr" });
    expect("sessionId" in args).toBe(false);
  });

  it("echoes the sessionId back on every turn once known", () => {
    const s1 = convReducer(initialConv, { type: "SEND", text: "hi", ts: 1 });
    const s2 = convReducer(s1, { type: "REPLY", result: reply({ sessionId: "abc-123" }), ts: 2 });
    // No targetLanguage on a continuing turn, on purpose: the server owns the session's
    // language from the first reply, so re-asserting the picker would overrule a learner
    // who asked out loud for a different one mid-session.
    expect(chatRequestArgs(s2, "second turn", "en")).toEqual({
      message: "second turn",
      sessionId: "abc-123",
    });
    const s3 = convReducer(s2, { type: "SEND", text: "second turn", ts: 3 });
    const s4 = convReducer(s3, { type: "REPLY", result: reply({ sessionId: "abc-123", isNewSession: false }), ts: 4 });
    expect(chatRequestArgs(s4, "third", "en").sessionId).toBe("abc-123");
  });

  it("drops sessionId after END_SESSION so the next message starts fresh", () => {
    let s = convReducer(initialConv, { type: "REPLY", result: reply({ sessionId: "x" }), ts: 1 });
    s = convReducer(s, { type: "END_SESSION" });
    expect(s.sessionId).toBeNull();
    expect("sessionId" in chatRequestArgs(s, "new chat", "en")).toBe(false);
  });
});

describe("chatRequestArgs — who owns the language", () => {
  it("sends the picker language only when opening a session", () => {
    expect(chatRequestArgs({ sessionId: null }, "bonjour", "fr")).toEqual({
      message: "bonjour",
      targetLanguage: "fr",
    });
  });

  it("does not send it once a session exists", () => {
    const args = chatRequestArgs({ sessionId: "s-1" }, "bonjour", "fr");
    expect("targetLanguage" in args).toBe(false);
  });
});

describe("convReducer", () => {
  it("sets remembered ONLY from memoryReferenced=true (never faked)", () => {
    let s = convReducer(initialConv, { type: "REPLY", result: reply({ memoryReferenced: true }), ts: 1 });
    expect(s.turns[0].remembered).toBe(true);
    s = convReducer(s, { type: "REPLY", result: reply({ memoryReferenced: false }), ts: 2 });
    expect(s.turns[1].remembered).toBe(false);
  });

  it("labels the handover ONLY when the server changed language", () => {
    let s = convReducer(initialConv, {
      type: "REPLY",
      result: reply({ language: "es", languageName: "Spanish", languageChanged: true }),
      ts: 1,
    });
    expect(s.turns[0].switchedTo).toBe("Spanish");
    // A turn that merely continued in the same language must not claim a switch.
    s = convReducer(s, {
      type: "REPLY",
      result: reply({ language: "es", languageName: "Spanish", languageChanged: false }),
      ts: 2,
    });
    expect(s.turns[1].switchedTo).toBeUndefined();
  });

  it("SEND marks sending and appends the user turn verbatim", () => {
    const s = convReducer(initialConv, { type: "SEND", text: "  spaced  ", ts: 5 });
    expect(s.sending).toBe(true);
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]).toMatchObject({ role: "user", text: "  spaced  " });
  });

  it("FAIL clears sending and records the error; REPLY clears nothing but appends", () => {
    let s = convReducer(initialConv, { type: "SEND", text: "x", ts: 1 });
    s = convReducer(s, { type: "FAIL", error: "boom" });
    expect(s.sending).toBe(false);
    expect(s.error).toBe("boom");
    s = convReducer(s, { type: "SEND", text: "y", ts: 2 });
    expect(s.error).toBeNull();
  });

  it("END_SESSION keeps the transcript visible but ends the session", () => {
    let s = convReducer(initialConv, { type: "REPLY", result: reply(), ts: 1 });
    s = convReducer(s, { type: "END_SESSION" });
    expect(s.turns).toHaveLength(1);
    expect(s.sessionEnded).toBe(true);
  });
});
