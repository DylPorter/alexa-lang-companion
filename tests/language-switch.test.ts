/**
 * Conversational language switching — server side.
 *
 * The behaviour this exists to lock in is the one a speaker demo lives or dies on:
 * a learner says "let's speak German" and the session continues in German, with the
 * same transcript, the same session id and the stored review knowing both languages
 * happened. It also guards the regression that made the feature necessary in the
 * first place — `chat` used to resolve the language as `targetLanguage ?? "en"`, so
 * any turn that omitted the parameter silently reset an ongoing French session to
 * English.
 *
 * Assertions read the SYSTEM PROMPT that EchoLLM records (`llm.calls`), because the
 * prompt is where the persona's language actually lives; the canned echo replies are
 * English whatever the language and would prove nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createSalaHttpServer } from "../src/server/http.js";
import { MemoryStore } from "../src/memory/db.js";
import { ChatMessage, LLM } from "../src/llm/types.js";

/**
 * A stand-in backend that records the system prompt of every phase and answers just
 * enough to keep the pipeline moving. It reports `name: "proxy"` on purpose: with
 * "echo", `extractReview` short-circuits to the heuristic table and never builds a
 * review prompt at all, which is exactly the wiring this file has to observe. The
 * returned review has no vocabulary, so extraction legitimately falls back — the
 * assertion is about what the prompt SAID, not about what the model produced.
 */
class RecordingLLM implements LLM {
  readonly name = "proxy" as const;
  readonly calls: Array<{ phase: string; system: string }> = [];

  async invoke(phase: "chat" | "review", system: string, messages: ChatMessage[]): Promise<string> {
    this.calls.push({ phase, system });
    if (phase === "review") return JSON.stringify({ vocabulary: [], grammar: [], summary: "recorded" });
    return `recording: ${messages.at(-1)?.content ?? ""}`;
  }
}

let httpServer: http.Server;
let memory: MemoryStore;
let llm: RecordingLLM;
let client: Client;

/** The system prompt of the most recent `chat` call. */
function lastChatPrompt(): string {
  const call = [...llm.calls].reverse().find((c) => c.phase === "chat");
  if (!call) throw new Error("no chat call recorded");
  return call.system;
}

async function chat(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await client.callTool({ name: "chat", arguments: args });
  expect(res.isError, `chat failed: ${JSON.stringify(res.content)}`).toBeFalsy();
  return (res.structuredContent ?? {}) as Record<string, unknown>;
}

beforeAll(async () => {
  memory = new MemoryStore(":memory:", "switch-user");
  llm = new RecordingLLM();
  httpServer = createSalaHttpServer({ memory, llm });
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const addr = httpServer.address();
  if (typeof addr === "string" || addr === null) throw new Error("no address");
  client = new Client({ name: "sala-switch-test", version: "0.1.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${addr.port}/mcp`)),
  );
});

afterAll(async () => {
  await client?.close();
  httpServer?.close();
  await once(httpServer, "close").catch(() => undefined);
  memory?.close();
});

describe("chat keeps the session's language", () => {
  let sid = "";

  it("opens in the language asked for", async () => {
    const r = await chat({ message: "Bonjour Sala ! Comment ça va ?", targetLanguage: "fr" });
    sid = r.sessionId as string;
    expect(r.language).toBe("fr");
    expect(r.languageName).toBe("French");
    expect(r.languageChanged).toBe(false);
    expect(lastChatPrompt()).toContain("native speaker of French");
  });

  it("a later turn WITHOUT targetLanguage stays French (the old snap-back bug)", async () => {
    const r = await chat({ message: "Je suis allé au marché aujourd'hui.", sessionId: sid });
    expect(r.language).toBe("fr");
    expect(r.languageChanged).toBe(false);
    expect(lastChatPrompt()).toContain("native speaker of French");
    expect(lastChatPrompt()).not.toContain("native speaker of English");
  });

  it("an explicit targetLanguage on a live session changes it and says so", async () => {
    const r = await chat({ message: "Erzähl mir was.", sessionId: sid, targetLanguage: "de" });
    expect(r.language).toBe("de");
    expect(r.languageChanged).toBe(true);
    expect(lastChatPrompt()).toContain("native speaker of German");
  });

  it("switches when the learner ASKS IN WORDS, and acknowledges the handover", async () => {
    const r = await chat({ message: "Actually, let's speak Spanish from now on.", sessionId: sid });
    expect(r.language).toBe("es");
    expect(r.languageChanged).toBe(true);
    expect(r.languageName).toBe("Spanish");
    const prompt = lastChatPrompt();
    expect(prompt).toContain("native speaker of Spanish");
    // The persona is told to open with one short clause in the new language — that is
    // what makes the switch audible to anyone in the room instead of a silent restart.
    expect(prompt).toContain("just asked to switch from German");
    expect(prompt).toContain("Do not switch back");
  });

  it("records which language each turn arrived in", () => {
    const rows = memory.getTranscript(sid);
    // The request itself was spoken in German; the answer came back in Spanish.
    const asking = rows.find((m) => m.content.includes("let's speak Spanish"))!;
    expect(asking.language).toBe("de");
    const answer = rows[rows.findIndex((m) => m === asking) + 1]!;
    expect(answer.role).toBe("assistant");
    expect(answer.language).toBe("es");
  });

  it("the session's stored language is the CURRENT one", () => {
    expect(memory.getSession(sid)!.language).toBe("es");
  });

  it("talking ABOUT a language does not switch", async () => {
    const r = await chat({
      message: "How do you say thank you in Japanese? My sister learned Chinese for years.",
      sessionId: sid,
    });
    expect(r.languageChanged).toBe(false);
    expect(r.language).toBe("es");
    expect(lastChatPrompt()).toContain("native speaker of Spanish");
  });

  it("the end-of-session review is told the session was mixed", async () => {
    const res = await client.callTool({ name: "end_session", arguments: { sessionId: sid } });
    expect(res.isError).toBeFalsy();
    const reviewCall = [...llm.calls].reverse().find((c) => c.phase === "review")!;
    expect(reviewCall.system).toContain("This session was NOT all one language");
    expect(reviewCall.system).toContain("German");
    expect(reviewCall.system).toContain("Spanish");
  });

  it("a single-language session gets no mixed-language claim", async () => {
    const plain = await chat({ message: "Hello there.", targetLanguage: "en" });
    await chat({ message: "I went running today.", sessionId: plain.sessionId });
    llm.calls.length = 0;
    await client.callTool({ name: "end_session", arguments: { sessionId: plain.sessionId } });
    const reviewCall = [...llm.calls].reverse().find((c) => c.phase === "review")!;
    expect(reviewCall.system).not.toContain("NOT all one language");
  });
});

describe("set_language tool", () => {
  it("is exposed on the MCP surface", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("set_language");
  });

  it("retargets a live session and reports previous + new", async () => {
    const open = await chat({ message: "Hola.", targetLanguage: "es" });
    const res = await client.callTool({
      name: "set_language",
      arguments: { sessionId: open.sessionId, language: "it" },
    });
    expect(res.isError).toBeFalsy();
    const s = res.structuredContent as Record<string, unknown>;
    expect(s).toMatchObject({ previousLanguage: "es", language: "it", languageName: "Italian", changed: true });
    // …and the next chat turn follows it without being told.
    await chat({ message: "Ciao!", sessionId: open.sessionId });
    expect(lastChatPrompt()).toContain("native speaker of Italian");
  });

  it("accepts a name, not only a code", async () => {
    const open = await chat({ message: "Hi.", targetLanguage: "en" });
    const res = await client.callTool({
      name: "set_language",
      arguments: { sessionId: open.sessionId, language: "français" },
    });
    expect((res.structuredContent as Record<string, unknown>).language).toBe("fr");
  });

  it("is honest about a no-op", async () => {
    const open = await chat({ message: "Bonjour.", targetLanguage: "fr" });
    const res = await client.callTool({
      name: "set_language",
      arguments: { sessionId: open.sessionId, language: "fr" },
    });
    expect((res.structuredContent as Record<string, unknown>).changed).toBe(false);
    const text = (res.content as Array<{ text?: string }>).map((c) => c.text).join("");
    expect(text).toContain("Already speaking");
  });

  it("refuses an unknown session instead of inventing one", async () => {
    const res = await client.callTool({
      name: "set_language",
      arguments: { sessionId: "no-such-session", language: "fr" },
    });
    expect(res.isError).toBe(true);
    expect(memory.getSession("no-such-session")).toBeNull();
  });

  it("carries an unknown BCP-47 code through rather than refusing it", async () => {
    // The name table is for understanding words, not for gating a client that knows
    // what it asked for: "nl" is a real language Sala can be told to speak.
    const open = await chat({ message: "Hallo.", targetLanguage: "en" });
    const res = await client.callTool({
      name: "set_language",
      arguments: { sessionId: open.sessionId, language: "nl" },
    });
    const s = res.structuredContent as Record<string, unknown>;
    expect(s.language).toBe("nl");
    expect(s.languageName).toContain("nl");
  });
});

describe("a switch asked in the FIRST utterance (issue #4)", () => {
  /**
   * The path a speaker demo actually walks: the learner opens the session by saying what
   * they want, and the device has already attached its own picker value to the request.
   * If the explicit parameter won, the words lost — Sala replied in Spanish while
   * `language` stayed "en", so the pill never rendered, the picker stayed on English, the
   * transcript was tagged English and the TTS voice was English. Caught in the browser
   * pass on 2026-10-23, two exchanges before it was filmed.
   */
  it("the words beat the device's opening targetLanguage", async () => {
    const r = await chat({ message: "Let's speak Spanish from now on.", targetLanguage: "en" });
    expect(r.isNewSession).toBe(true);
    expect(r.language).toBe("es");
    expect(r.languageChanged).toBe(true);
    expect(r.languageName).toBe("Spanish");
    expect(lastChatPrompt()).toContain("native speaker of Spanish");
    expect(lastChatPrompt()).toContain("just asked to switch from English");
  });

  it("tags the opening turn with the language it arrived in", async () => {
    const r = await chat({ message: "Can we do German instead?", targetLanguage: "en" });
    const sid = r.sessionId as string;
    const rows = memory.getTranscript(sid);
    expect(rows[0]).toMatchObject({ role: "user", language: "en" });
    expect(rows[1]).toMatchObject({ role: "assistant", language: "de" });
    expect(memory.languagesBySession([sid])[sid]).toEqual(["en", "de"]);
  });

  it("a first-utterance switch still reaches the review as a mixed session", async () => {
    const r = await chat({ message: "Let's speak Portuguese now.", targetLanguage: "en" });
    const sid = r.sessionId as string;
    await chat({ message: "Obrigado, hoje fui ao mercado.", sessionId: sid });
    llm.calls.length = 0;
    await client.callTool({ name: "end_session", arguments: { sessionId: sid } });
    const reviewCall = [...llm.calls].reverse().find((c) => c.phase === "review")!;
    expect(reviewCall.system).toContain("NOT all one language");
    expect(reviewCall.system).toContain("English");
    expect(reviewCall.system).toContain("Portuguese");
  });

  it("an opening targetLanguage still wins when the words ask for nothing", async () => {
    // Detection only fires on a request shape, so a plain greeting in the device's
    // language is unaffected by the flip: the parameter is still honoured, not ignored.
    const r = await chat({ message: "Bonjour, ça va ?", targetLanguage: "fr" });
    expect(r.language).toBe("fr");
    expect(r.languageChanged).toBe(false);
  });

  it("a first utterance that only MENTIONS a language does not switch", async () => {
    const r = await chat({ message: "I wrote an essay about Chinese food.", targetLanguage: "en" });
    expect(r.language).toBe("en");
    expect(r.languageChanged).toBe(false);
  });
});
