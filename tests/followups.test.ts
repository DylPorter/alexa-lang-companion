/**
 * Cross-session memory that ACTS (cross-session follow-ups) — the two halves Dylan asked for:
 *
 *  1. "I'm stressed about my interview" in one session ⇒ the NEXT session opens by
 *     asking how it went.
 *  2. The same grammar habit in 2+ different sessions ⇒ Sala puts more weight on it.
 *
 * Both are memory claims, so both are held to the rule the rest of the repo lives by:
 * the words must come from stored rows, and nothing is asserted that the database does
 * not hold. That makes the interesting tests the negative ones — a mood with no event,
 * an event already in the past, a topic already asked about, an empty database.
 *
 * Fully offline: cue detection and prompts are pure functions, the store is `:memory:`,
 * the MCP half runs EchoLLM over loopback HTTP.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createSalaHttpServer } from "../src/server/http.js";
import { MemoryStore } from "../src/memory/db.js";
import { EchoLLM, parseFollowUpLines } from "../src/llm/echo.js";
import { FOLLOW_UP_MARKER, RECALL_MARKER } from "../src/llm/types.js";
import {
  MAX_FOLLOWUPS_PER_SESSION,
  detectFollowUps,
  supportsFollowUps,
} from "../src/memory/followups.js";
import { chatSystemPrompt, followUpBlock, reviewSystemPrompt } from "../src/persona/prompts.js";
import { prioritiseRecurring } from "../src/review/extract.js";
import type { GrammarItem, Review } from "../src/memory/db.js";

const AT = "2026-10-17T09:00:00.000Z";
const turns = (...texts: string[]) => texts.map((text) => ({ text, at: AT }));
const topicsFor = (text: string, lang: string) => detectFollowUps(turns(text), lang).map((s) => s.topic);

// ------------------------------------------------------- the detector (a mood is not an event)

describe("detectFollowUps — an event, in the learner's words, that can have happened", () => {
  it("the feeling shape needs no time marker", () => {
    expect(topicsFor("I'm really stressed about my job interview on Monday", "en")).toEqual(["interview"]);
    expect(topicsFor("i'm nervous about my interview", "en")).toEqual(["interview"]);
    expect(topicsFor("I'm worried about my exam tomorrow", "en")).toEqual(["exam"]);
    expect(topicsFor("the test is next week and I'm dreading it", "en")).toEqual(["exam"]);
    expect(topicsFor("I'm scared of my audition", "en")).toEqual(["audition"]);
  });

  it("the scheduled shape only counts with a time marker", () => {
    expect(topicsFor("I have an interview on Friday", "en")).toEqual(["interview"]);
    expect(topicsFor("I'm going to have an exam next week", "en")).toEqual(["exam"]);
    // no time marker → not established as upcoming, so nothing is stored
    expect(topicsFor("I have an interview", "en")).toEqual([]);
  });

  it("a mood about a non-event, and an event noun inside another phrase, are not events", () => {
    expect(topicsFor("I'm stressed about traffic", "en")).toEqual([]);
    expect(topicsFor("I'm stressed about this weather", "en")).toEqual([]);
    // "interview" is present but as a modifier of "question", and nothing says upcoming
    expect(topicsFor("I have an interview question for you", "en")).toEqual([]);
    expect(topicsFor("J'ai un entretien de problème", "fr")).toEqual([]);
  });

  it("a past marker vetoes the whole turn — missing a question beats inventing one", () => {
    expect(topicsFor("I had an interview last week", "en")).toEqual([]);
    expect(topicsFor("My interview went badly yesterday", "en")).toEqual([]);
    expect(topicsFor("I'm stressed about the interview I already finished", "en")).toEqual([]);
    expect(topicsFor("Hier j'ai raté mon examen", "fr")).toEqual([]);
    expect(topicsFor("Ich hatte gestern einen Test", "de")).toEqual([]);
    expect(topicsFor("Tuve un examen ayer", "es")).toEqual([]);
  });

  it("accents, case and plurals do not hide an event", () => {
    expect(topicsFor("Je suis stressée pour mon entretien", "fr")).toEqual(["interview"]);
    expect(topicsFor("J'ai un entretien demain", "fr")).toEqual(["interview"]);
    expect(topicsFor("Ich bin nervös wegen meiner Prüfung", "de")).toEqual(["exam"]);
    expect(topicsFor("Ich habe am Freitag ein Vorstellungsgespräch", "de")).toEqual(["interview"]);
    expect(topicsFor("Estoy preocupada por las entrevistas", "es")).toEqual(["interview"]);
    expect(topicsFor("Tengo una entrevista el viernes", "es")).toEqual(["interview"]);
  });

  it("one turn can carry several events, capped, one row per topic", () => {
    const many = detectFollowUps(
      turns(
        "I'm stressed about my interview and my exam and my audition and my competition",
        "Also my interview is on Monday",
      ),
      "en",
    );
    expect(many.length).toBeLessThanOrEqual(MAX_FOLLOWUPS_PER_SESSION);
    expect(new Set(many.map((m) => m.topic)).size).toBe(many.length);
  });

  it("the QUOTE is the learner's own turn, verbatim — including its punctuation", () => {
    const said = "I'm really stressed about my job interview on Monday, I don't know what to say.";
    const [seed] = detectFollowUps(turns(said), "en");
    expect(seed.quote).toBe(said);
    expect(seed.saidAt).toBe(AT); // the transcript row's own timestamp, not now()
    expect(seed.language).toBe("en");
  });

  it("a language with no verified cue table produces nothing at all", () => {
    expect(supportsFollowUps("en")).toBe(true);
    expect(supportsFollowUps("ja")).toBe(false);
    expect(topicsFor("面接が心配です", "ja")).toEqual([]);
    // and the phrase list is never consulted for a language it was not written for
    expect(topicsFor("I'm stressed about my interview", "ja")).toEqual([]);
  });

  it("Sala's own words are never a memory: only role=user rows reach the detector", async () => {
    const { finishSession } = await import("../src/server/session.js");
    const store = new MemoryStore(":memory:", "fu-role");
    try {
      store.createSession("en", "en", "role-1");
      // the ASSISTANT mentions an interview; the learner never does
      store.addMessage("role-1", "assistant", "So you have an interview on Monday — good luck!", "en");
      store.addMessage("role-1", "user", "Thanks, I am just tired today.", "en");
      const finished = await finishSession(store, undefined, "role-1");
      // no LLM => the heuristic review path, but follow-up detection is deterministic anyway
      if (!finished) throw new Error("finishSession returned null for a session that exists");
      expect(finished.followUps).toEqual([]);
      expect(store.pendingFollowUps()).toEqual([]);
    } finally {
      store.close();
    }
  });
});

// ------------------------------------------------------------------ prompt contract

describe("chat prompt — the follow-up and emphasis blocks", () => {
  const cfg = { targetLanguage: "en", nativeLanguage: "en" };

  it("no pending rows ⇒ no FOLLOW-UP section and no marker in the prompt", () => {
    const prompt = chatSystemPrompt(cfg, []);
    expect(prompt).not.toContain(FOLLOW_UP_MARKER);
    expect(prompt).not.toMatch(/WORKING ON/);
    expect(prompt).not.toContain(RECALL_MARKER);
  });

  it("the quote reaches the prompt verbatim, and the hard rule travels with it", () => {
    const quote = "I'm really stressed about my job interview on Monday";
    const prompt = chatSystemPrompt(
      { ...cfg, followUps: [{ topic: "interview", quote, saidAt: AT, language: "en" }] },
      [],
    );
    expect(prompt).toContain(FOLLOW_UP_MARKER);
    expect(prompt).toContain(`- interview · 2026-10-17 · "${quote}"`);
    expect(prompt).toContain("only these events");
    expect(prompt).toContain("Never invent one");
    // asked once: the block tells the model not to re-ask if the learner already answered
    expect(prompt).toMatch(/already told you how it went/);
  });

  it("the review prompt is told the habit as a priority, with the counts behind it", () => {
    const prompt = reviewSystemPrompt({
      ...cfg,
      emphasis: [{ label: "Past tense after time markers", sessions: 2, lastDate: AT }],
    });
    expect(prompt).toMatch(
      /more than one earlier session: "Past tense after time markers" \(2 past sessions\)/,
    );
    // a priority, not new content: it may not manufacture a point the learner did not say
    expect(prompt).toMatch(/If none of them appears, ignore this paragraph entirely/);
    // and with no habits stored, the reviewer is never told to look for one
    expect(reviewSystemPrompt(cfg)).not.toMatch(/more than one earlier session/);
  });

  it("emphasis is a teaching posture, and the prompt says it may not be spoken", () => {
    const prompt = chatSystemPrompt(
      { ...cfg, emphasis: [{ label: "Past tense after time markers", sessions: 3, lastDate: AT }] },
      [],
    );
    expect(prompt).toMatch(/WORKING ON — habits that keep coming back/);
    expect(prompt).toContain('"Past tense after time markers" — 3 past sessions, most recent 2026-10-17');
    expect(prompt).toContain("never mention a session count");
    // and the count never comes from the model: the line is built from the row
    expect(followUpBlock([{ topic: "exam", quote: "q", saidAt: AT, language: "en" }], "English")).toContain(
      "- exam · 2026-10-17 · \"q\"",
    );
  });
});

// ------------------------------------------------------------------------ echo

describe("EchoLLM follows the same contract as a live model", () => {
  const promptFor = (quote: string) =>
    chatSystemPrompt(
      { targetLanguage: "en", nativeLanguage: "en", followUps: [{ topic: "interview", quote, saidAt: AT, language: "en" }] },
      [],
    );

  it("reads the block back out of the prompt it was handed", () => {
    const lines = parseFollowUpLines(promptFor("I'm stressed about my interview"));
    expect(lines).toEqual([{ topic: "interview", saidOn: "2026-10-17", quote: "I'm stressed about my interview" }]);
    expect(parseFollowUpLines(chatSystemPrompt({ targetLanguage: "en", nativeLanguage: "en" }, []))).toEqual([]);
  });

  it("asks about the event on the opener and quotes the stored row", async () => {
    const echo = new EchoLLM();
    const reply = await echo.invoke("chat", promptFor("I'm stressed about my interview"), [
      { role: "user", content: "Hi" },
    ]);
    expect(reply).toMatch(/how did the interview go/i);
    expect(reply).toContain("I'm stressed about my interview");
  });
});

// --------------------------------------------------------------------------- store

describe("MemoryStore follow-up rows", () => {
  let store: MemoryStore;
  beforeAll(() => {
    store = new MemoryStore(":memory:", "fu-store");
  });
  afterAll(() => store.close());

  /**
   * `followups.session_id` carries a real FOREIGN KEY and better-sqlite3 enforces it,
   * so a stored question can only ever belong to a session that happened. The fixture
   * has to honour that: create the session first, then record against it.
   */
  const known = new Set<string>();
  const add = (sessionId: string, topic: string, quote: string, saidAt: string) => {
    if (!known.has(sessionId)) {
      store.createSession("en", "en", sessionId);
      known.add(sessionId);
    }
    return store.recordFollowUp({ sessionId, topic, quote, language: "en", saidAt });
  };

  it("the same topic twice is ONE pending question (the unique index decides, not a check)", () => {
    add("s1", "interview", "I'm stressed about my interview", "2026-10-17T09:00:00.000Z");
    const second = add("s2", "interview", "My interview is Monday, I'm nervous", "2026-10-18T09:00:00.000Z");
    expect(second).toBeNull();
    expect(store.pendingFollowUps()).toHaveLength(1);
  });

  it("once it has been offered it is gone for good, and a NEW mention can be stored again", () => {
    const [row] = store.pendingFollowUps();
    store.markFollowUpsOffered([row.id], "live-session");
    expect(store.pendingFollowUps()).toEqual([]);
    // offered-once is not "never again": a fresh interview mentioned later is a fresh memory
    expect(add("s3", "interview", "I've got another interview next week", "2026-10-22T09:00:00.000Z")).toBeTypeOf("number");
    expect(store.pendingFollowUps({ excludeSessionId: "s3" })).toEqual([]); // own session excluded
    expect(store.pendingFollowUps()[0].quote).toBe("I've got another interview next week");
  });

  it("marking is idempotent — a second offer does not rewrite the first", () => {
    add("s4", "exam", "I'm worried about my exam", "2026-10-20T09:00:00.000Z");
    const exam = store.pendingFollowUps().find((f) => f.topic === "exam")!;
    store.markFollowUpsOffered([exam.id], "session-a");
    const first = store.db
      .prepare(`SELECT offered_at, offered_session FROM followups WHERE id = ?`)
      .get(exam.id) as { offered_at: string; offered_session: string };
    store.markFollowUpsOffered([exam.id], "session-b");
    const again = store.db.prepare(`SELECT offered_at, offered_session FROM followups WHERE id = ?`).get(exam.id) as {
      offered_at: string;
      offered_session: string;
    };
    expect(again).toEqual(first);
    expect(first.offered_session).toBe("session-a");
  });

  it("newest pending first, capped", () => {
    add("s5", "audition", "I'm terrified of my audition", "2026-10-23T09:00:00.000Z");
    add("s6", "competition", "I'm nervous about the race", "2026-10-24T09:00:00.000Z");
    // three topics are pending by now; the cap returns the two most RECENTLY mentioned,
    // so the opener is about what the learner last cared about, not the oldest row.
    const pending = store.pendingFollowUps({ limit: 2 });
    expect(pending).toHaveLength(2);
    expect(pending.map((f) => f.topic)).toEqual(["competition", "audition"]);
  });

  it("another learner's pending questions are not yours", () => {
    const other = new MemoryStore(":memory:", "fu-other");
    try {
      other.createSession("en", "en", "x");
      other.recordFollowUp({ sessionId: "x", topic: "interview", quote: "mine", language: "en", saidAt: AT });
      expect(other.pendingFollowUps().map((f) => f.quote)).toEqual(["mine"]);
      expect(store.pendingFollowUps().every((f) => f.quote !== "mine")).toBe(true);
    } finally {
      other.close();
    }
  });
});

describe("MemoryStore.recurringMistakes — the 2+ sessions gate", () => {
  const review = (items: GrammarItem[]): Review => ({ vocabulary: [], grammar: items, summary: "s" });
  const item = (mistakeId: string, point: string): GrammarItem => ({
    mistakeId,
    point,
    example: "Yesterday I go to the gym.",
    correction: "I went",
    explanation: "past",
  });

  it("one past session is a habit forming; two is the emphasis gate", () => {
    const store = new MemoryStore(":memory:", "fu-emphasis");
    const end = (sid: string, day: number) => {
      store.createSession("en", "en", sid);
      store.endSession(sid, "s", review([item("en-past-tense-adverb", "Past tense after time markers")]));
      store.db.prepare(`UPDATE session_mistakes SET recorded_at = ? WHERE session_id = ?`)
        .run(`2026-10-0${day}T08:00:00.000Z`, sid);
    };
    try {
      end("a", 1);
      // ONE session: the habit is real and visible below the gate, and the gate is shut.
      expect(store.recurringMistakes({ language: "en", minSessions: 1 })).toEqual([
        {
          mistakeId: "en-past-tense-adverb",
          label: "Past tense after time markers",
          sessions: 1,
          lastDate: "2026-10-01T08:00:00.000Z",
        },
      ]);
      expect(store.recurringMistakes({ language: "en", minSessions: 2 })).toEqual([]);

      end("b", 2);
      // Same identity in two sessions = ONE habit row counted twice (COUNT DISTINCT
      // session_id), not two habits — which is exactly what "2+ sessions" has to mean.
      expect(store.recurringMistakes({ language: "en", minSessions: 1 })).toHaveLength(1);
      const gated = store.recurringMistakes({ language: "en", minSessions: 2 });
      expect(gated).toHaveLength(1);
      expect(gated[0].sessions).toBe(2);
      expect(gated[0].label).toBe("Past tense after time markers"); // prose from the newest stored row
      expect(gated[0].lastDate).toBe("2026-10-02T08:00:00.000Z");
    } finally {
      store.close();
    }
  });

  it("the live session is never counted — its rows do not exist yet", () => {
    const store = new MemoryStore(":memory:", "fu-live");
    try {
      store.createSession("en", "en", "done-1");
      store.endSession("done-1", "s", review([item("en-third-person-s", "Third-person -s")]));
      // "ongoing" has said the mistake twice already, but nothing is written until it ends
      store.createSession("en", "en", "ongoing");
      const found = store.recurringMistakes({ language: "en", minSessions: 1 });
      expect(found.map((f) => f.sessions)).toEqual([1]);
      expect(store.recurringMistakes({ language: "en", minSessions: 2 })).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("habits are keyed by the identity's own language prefix, not the session's last language", () => {
    const store = new MemoryStore(":memory:", "fu-lang");
    try {
      for (const sid of ["de-1", "de-2"]) {
        store.createSession("de", "en", sid);
        store.endSession(sid, "s", review([item("de-perf-haben-sein", "Perfekt: sein or haben")]));
      }
      expect(store.recurringMistakes({ language: "de", minSessions: 2 }).map((f) => f.mistakeId)).toEqual([
        "de-perf-haben-sein",
      ]);
      // an English session gets no German habit, even though it is the same learner
      expect(store.recurringMistakes({ language: "en", minSessions: 2 })).toEqual([]);
      // and no language filter = every habit (what `recall` shows)
      expect(store.recurringMistakes({ minSessions: 2 })).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("a row written before the `point` column existed falls back to the identity, never a guess", () => {
    const store = new MemoryStore(":memory:", "fu-label");
    try {
      for (const sid of ["l-1", "l-2"]) {
        store.createSession("en", "en", sid);
        store.endSession(sid, "s", review([item("en-third-person-s", "Third-person -s in the present")]));
      }
      store.db.exec(`UPDATE session_mistakes SET point = ''`);
      const [habit] = store.recurringMistakes({ language: "en", minSessions: 2 });
      expect(habit.label).toBe("third person s"); // readable form of the stored key
    } finally {
      store.close();
    }
  });
});

describe("prioritiseRecurring — the habit leads the panel", () => {
  const g = (point: string, recurrence?: { seenInSessions: number; firstDate: string }): GrammarItem => ({
    point,
    example: "x",
    correction: "y",
    explanation: "z",
    ...(recurrence ? { recurrence } : {}),
  });

  it("recurred items come first, everything keeps its relative order", () => {
    const review: Review = {
      vocabulary: [],
      grammar: [g("first-time A"), g("recurring B", { seenInSessions: 3, firstDate: "d" }), g("first-time C"), g("recurring D", { seenInSessions: 2, firstDate: "d" })],
      summary: "s",
    };
    const out = prioritiseRecurring(review);
    expect(out.grammar.map((x) => x.point)).toEqual(["recurring B", "recurring D", "first-time A", "first-time C"]);
    expect(out.vocabulary).toEqual(review.vocabulary);
    expect(out.summary).toBe("s");
    // nothing invented: same items, same objects
    expect(out.grammar.length).toBe(4);
  });

  it("a review with no recurrence is returned untouched (same object, no reorder)", () => {
    const review: Review = { vocabulary: [], grammar: [g("A"), g("B")], summary: "s" };
    expect(prioritiseRecurring(review)).toBe(review);
  });
});

// --------------------------------------------------------------------- clearAll

describe("MemoryStore.clearAll — the wipe leaves no ghost behind", () => {
  it("deletes this account's rows and rebuilds the FTS index so recall cannot answer from them", () => {
    const store = new MemoryStore(":memory:", "fu-clear");
    try {
      store.createSession("en", "en", "c-1");
      store.addMessage("c-1", "user", "I went to the piano recital", "en");
      store.logActivity("Practiced the piano for 40 minutes");
      store.endSession("c-1", "A piano session", { vocabulary: [], grammar: [], summary: "A piano session" });
      store.recordFollowUp({ sessionId: "c-1", topic: "recital", quote: "I went to the piano recital", language: "en", saidAt: AT });
      expect(store.recall({ query: "piano" }).activities).toHaveLength(1);

      const counts = store.clearAll();
      expect(counts).toMatchObject({ sessions: 1, messages: 1, activities: 1, session_mistakes: 0, followups: 1 });
      expect(store.listSessions()).toEqual([]);
      // the point of the FTS rebuild: a stale index would still MATCH the deleted rows
      expect(store.recall({ query: "piano" })).toEqual({ activities: [], pastSessions: [] });
      expect(store.pendingFollowUps()).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("wipes one account and leaves the other's history standing", () => {
    const dir = mkdtempSync(join(tmpdir(), "sala-clear-"));
    const path = join(dir, "shared.db");
    try {
      const a = new MemoryStore(path, "fu-keep-a");
      a.createSession("en", "en", "keep-a");
      a.addMessage("keep-a", "user", "I practised the piano", "en");
      a.logActivity("Practiced the piano for 40 minutes");
      a.endSession("keep-a", "Piano", { vocabulary: [], grammar: [], summary: "Piano" });
      a.recordFollowUp({ sessionId: "keep-a", topic: "recital", quote: "I practised the piano", language: "en", saidAt: AT });
      a.close();

      const b = new MemoryStore(path, "fu-keep-b");
      expect(b.clearAll().sessions).toBe(0); // nothing of B's to delete
      b.close();

      const again = new MemoryStore(path, "fu-keep-a");
      expect(again.listSessions().map((x) => x.id)).toEqual(["keep-a"]);
      expect(again.pendingFollowUps()).toHaveLength(1);
      expect(again.clearAll().sessions).toBe(1);
      expect(again.listSessions()).toEqual([]);
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --------------------------------------------------------------- over MCP, in order

describe("the two beats over MCP (Echo, offline, sequential sessions)", () => {
  let httpServer: http.Server;
  let memory: MemoryStore;
  let echo: EchoLLM;
  let client: Client;

  const INTERVIEW = "I'm really stressed about my job interview on Monday, I don't know what to say.";
  const MISTAKE = "Yesterday I go to the climbing wall with my friend Daniel.";

  async function call(name: string, args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError, `${name} errored: ${JSON.stringify(result.content)}`).toBeFalsy();
    return {
      structured: (result.structuredContent ?? {}) as Record<string, any>,
      text: (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("\n"),
    };
  }

  /** One conversation: chat each message in order, then return its turns. */
  async function session(...messages: string[]) {
    let sessionId: string | undefined;
    const outs = [];
    for (const message of messages) {
      const { structured } = await call(
        "chat",
        sessionId ? { message, sessionId } : { message, targetLanguage: "en" },
      );
      sessionId = structured.sessionId as string;
      outs.push(structured);
    }
    return { sessionId: sessionId!, turns: outs };
  }

  beforeAll(async () => {
    memory = new MemoryStore(":memory:", "fu-mcp-user");
    echo = new EchoLLM();
    httpServer = createSalaHttpServer({ memory, llm: echo });
    httpServer.listen(0, "127.0.0.1");
    await once(httpServer, "listening");
    const addr = httpServer.address();
    if (typeof addr === "string" || addr === null) throw new Error("no address");
    client = new Client({ name: "followups-test", version: "0.1.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${addr.port}/mcp`)));
  });

  afterAll(async () => {
    await client?.close();
    httpServer?.close();
    await once(httpServer, "close").catch(() => undefined);
    memory?.close();
  });

  // Ordered on purpose: each beat depends on the rows the one before it stored.

  it("session 1: nothing pending on an empty DB; end_session stores the interview", async () => {
    const { turns } = await session("Hello there", INTERVIEW);
    expect(turns[0].isNewSession).toBe(true);
    expect(turns[0].followUps).toEqual([]); // no rows yet ⇒ no claim, not even a friendly guess
    expect(turns[0].memoryReferenced).toBe(false);

    const ended = await call("end_session", { sessionId: turns.at(-1)!.sessionId });
    expect(ended.structured.followUps).toHaveLength(1);
    expect(ended.structured.followUps[0]).toMatchObject({ topic: "interview", quote: INTERVIEW });
    expect(ended.structured.followUps[0].saidAt).toBeTypeOf("string");
    expect(ended.text).toContain("Stored for next session: interview");
    expect(ended.structured.review.summary).toContain("interview");
  });

  it("session 2 opens by asking how it went — once, and the badge lights up", async () => {
    const { turns } = await session("Hi Sala", "Not great, I blanked on every question.");
    expect(turns[0].isNewSession).toBe(true);
    expect(turns[0].memoryReferenced).toBe(true); // a stored row WAS handed to the model
    expect(turns[0].followUps.map((f: any) => f.topic)).toEqual(["interview"]);
    expect(turns[0].reply).toMatch(/how did the interview go/i);
    expect(turns[1].followUps).toEqual([]); // offered already: not re-asked in the same session
  });

  it("session 3 has nothing left to ask, and recall agrees the row is spent", async () => {
    const { turns } = await session("Hello again", "Yes — I got the job.");
    expect(turns[0].followUps).toEqual([]);
    const rec = await call("recall", { query: "interview" });
    expect(rec.structured.followUps).toEqual([]);
  });

  it("the third session works the habit that appeared in the two before it", async () => {
    for (let i = 0; i < 2; i++) {
      const { turns } = await session(MISTAKE);
      await call("end_session", { sessionId: turns[0].sessionId });
    }
    // session 5: emphasis on the opener AND on a later turn (the prompt is per-turn)
    // "Kumquat" on purpose: any ordinary greeting shares tokens with stored transcripts,
    // and then the memory badge would light from a keyword hit, not from a follow-up.
    const opener = await call("chat", { message: "Kumquat", targetLanguage: "en" });
    expect(opener.structured.reply).toBeTruthy();
    let system = echo.calls.at(-1)!.system;
    expect(system).toContain("WORKING ON — habits that keep coming back");
    expect(system).toMatch(/- "Past tense after time markers" — 2 past sessions/);

    await call("chat", { message: "I just came back from work", sessionId: opener.structured.sessionId });
    system = echo.calls.at(-1)!.system;
    expect(system).toContain("WORKING ON — habits that keep coming back");
    expect(system).toContain("never mention a session count");
    // the badge is about remembered LIFE facts; a habit count is not one of them
    expect(opener.structured.memoryReferenced).toBe(false);

    // session 6 ends with the habit in the panel's FIRST slot and the count grown
    const sixth = await session("Last weekend I go to the gym and I see my coach.");
    const ended = await call("end_session", { sessionId: sixth.turns[0].sessionId });
    const review = ended.structured.review;
    expect(review.grammar[0].mistakeId).toBe("en-past-tense-adverb");
    expect(review.grammar[0].recurrence.seenInSessions).toBe(3);
    // one habit recurred ⇒ the singular clause, with the date the row was FIRST logged.
    expect(review.summary).toMatch(
      /1 of these is a mistake you've made before, first logged on \d{4}-\d{2}-\d{2}\.$/,
    );
    // Echo never runs the LLM review pass (src/llm/echo.ts:14) — the heuristic path is
    // what produced the panel above, and it led with the habit. The review PROMPT that a
    // live model gets is pinned as a pure-function test instead.
  });

  it("recall is the transparency surface for both: pending questions and standing habits", async () => {
    const sid = memory.createSession("en", "en", "fu-manual");
    memory.recordFollowUp({
      sessionId: sid,
      topic: "audition",
      quote: "I'm terrified of my audition on Saturday",
      language: "en",
      saidAt: new Date().toISOString(),
    });
    const rec = await call("recall", {});
    expect(rec.structured.followUps.map((f: any) => f.topic)).toEqual(["audition"]);
    expect(rec.structured.focus).toHaveLength(1);
    expect(rec.structured.focus[0]).toMatchObject({
      mistakeId: "en-past-tense-adverb",
      label: "Past tense after time markers",
      sessions: 3,
    });
    expect(rec.text).toContain("\"followUps\"");
  });

  it("a fresh learner with no rows gets no blocks and makes no claims", async () => {
    memory.clearAll();
    const { turns } = await session("Hello, I am new here");
    expect(turns[0].followUps).toEqual([]);
    expect(turns[0].memoryReferenced).toBe(false);
    const system = echo.calls.at(-1)!.system;
    expect(system).not.toContain(FOLLOW_UP_MARKER);
    expect(system).not.toContain("WORKING ON");
    const ended = await call("end_session", { sessionId: turns[0].sessionId });
    expect(ended.structured.followUps).toEqual([]);
    expect(ended.structured.review.grammar).toEqual([]);
  });

  it("nothing on the MCP surface can wipe or seed the memory", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["chat", "end_session", "list_sessions", "log_activity", "recall", "set_language"]);
  });
});
