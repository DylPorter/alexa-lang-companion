/**
 * Cross-session grammar recurrence (issue #2) — "it pinpoints the habits you have
 * not fixed yet", and only when `session_mistakes` actually says so.
 *
 * The integrity rule under test, the same one that governs `memoryReferenced`:
 * a recurrence claim exists ONLY when real stored rows back it. No earlier rows ⇒
 * no `recurrence` field, no summary sentence, no "first time you've…" filler.
 *
 * Fully offline: identity is pure functions, the store is `:memory:`, the MCP half
 * runs on EchoLLM over loopback HTTP.
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
import { GrammarItem, MemoryStore, Review } from "../src/memory/db.js";
import { EchoLLM } from "../src/llm/echo.js";
import {
  annotateRecurrence,
  canonicalMistakeId,
  detectMistakes,
  extractReviewHeuristic,
  withMistakeIds,
} from "../src/review/extract.js";
import type { ChatMessage } from "../src/llm/types.js";

const reviewWith = (grammar: GrammarItem[], summary = "s"): Review => ({
  vocabulary: [],
  grammar,
  summary,
});
const item = (mistakeId: string, point = mistakeId): GrammarItem => ({
  mistakeId,
  point,
  example: "Yesterday I go to climbing wall.",
  correction: "I went",
  explanation: "past",
});

// ----------------------------------------------------------------- identity

describe("mistake identity — exact key, not similarity", () => {
  it("(a) two paraphrases collapse onto the same table id", () => {
    expect(canonicalMistakeId("de", "Perfekt with sein")).toBe("de-perf-haben-sein");
    expect(canonicalMistakeId("de", "sein-perfekt")).toBe("de-perf-haben-sein");
    expect(canonicalMistakeId("de", "perfekt with sein")).toBe(
      canonicalMistakeId("de", "SEIN  PERFEKT!"),
    );
    expect(canonicalMistakeId("en", "past simple")).toBe("en-past-tense-adverb");
    expect(canonicalMistakeId("en", "Simple Past")).toBe("en-past-tense-adverb");
    expect(canonicalMistakeId("en", "articles")).toBe("en-article-place");
    // accents fold, so an FR key survives being written with or without them
    expect(canonicalMistakeId("fr", "auxiliary être with aller")).toBe("fr-passe-compose-aller");
  });

  it("two different mistakes stay two different ids", () => {
    const ids = [
      canonicalMistakeId("de", "Perfekt with sein"),
      canonicalMistakeId("de", "feminine article die"),
      canonicalMistakeId("de", "accusative article den"),
      canonicalMistakeId("en", "past simple"),
      canonicalMistakeId("en", "third person singular"),
      canonicalMistakeId("en", "married preposition"),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("an unmapped label keeps its own slug (never dropped, never merged)", () => {
    expect(canonicalMistakeId("en", "Swedish fika culture")).toBe("en-swedish-fika-culture");
    // …and the same wording in a later session resolves to that key again
    expect(canonicalMistakeId("en", "Swedish fika culture")).toBe(
      canonicalMistakeId("en", "  Swedish  Fika Culture "),
    );
  });

  it("a heuristic item keeps its table id — prose never overwrites a known key", () => {
    const transcript: ChatMessage[] = [
      { role: "user", content: "Yesterday I go to climbing wall with my friend." },
    ];
    const detected = detectMistakes(transcript, "en");
    expect(detected[0].pattern.id).toBe("en-past-tense-adverb");
    const heuristic = extractReviewHeuristic(transcript, {
      targetLanguage: "en",
      nativeLanguage: "en",
    });
    expect(heuristic.grammar[0].mistakeId).toBe("en-past-tense-adverb");
    expect(withMistakeIds(heuristic, "en").grammar.map((g) => g.mistakeId)).toEqual(
      heuristic.grammar.map((g) => g.mistakeId),
    );
    // a model-written item that arrives as bare prose gets an id
    const proseOnly: GrammarItem = {
      point: "past simple",
      example: "Yesterday I go to climbing wall.",
      correction: "I went",
      explanation: "past",
    };
    const stamped = withMistakeIds(reviewWith([proseOnly]), "en");
    expect(stamped.grammar[0].mistakeId).toBe("en-past-tense-adverb");
    // …and an item that somehow has no id at all is skipped, never guessed into a count
    expect(annotateRecurrence(reviewWith([proseOnly]), () => ({ priorSessions: 3, firstDate: "x" })).recurred).toBe(0);
  });
});

// ------------------------------------------------------------------ the guard

describe("annotateRecurrence — the fabrication guard", () => {
  it("(c) no history ⇒ no recurrence field on any item, recurred = 0", () => {
    const { review: out, recurred } = annotateRecurrence(
      reviewWith([item("en-past-tense-adverb"), item("en-article-place")]),
      () => ({ priorSessions: 0, firstDate: null }),
    );
    expect(recurred).toBe(0);
    for (const g of out.grammar) expect("recurrence" in g).toBe(false);
    // and the store on an empty database agrees that there is no history
    const store = new MemoryStore(":memory:", "fresh-user");
    try {
      expect(store.mistakeHistory("en-past-tense-adverb", "any-session")).toEqual({
        priorSessions: 0,
        firstDate: null,
      });
    } finally {
      store.close();
    }
  });

  it("an item with no mistakeId can never be counted", () => {
    const { review: out, recurred } = annotateRecurrence(
      reviewWith([{ point: "no id", example: "x", correction: "y", explanation: "z" }]),
      () => ({ priorSessions: 5, firstDate: "2026-01-01T00:00:00.000Z" }),
    );
    expect(recurred).toBe(0);
    expect("recurrence" in out.grammar[0]).toBe(false);
  });

  it("one prior session becomes seenInSessions 2 — the current session counts once", () => {
    const { review: out, recurred } = annotateRecurrence(reviewWith([item("de-perf-haben-sein")]), () => ({
      priorSessions: 1,
      firstDate: "2026-10-19T20:00:00.000Z",
    }));
    expect(recurred).toBe(1);
    expect(out.grammar[0].recurrence).toEqual({
      seenInSessions: 2,
      firstDate: "2026-10-19T20:00:00.000Z",
    });
  });
});

// ----------------------------------------------------------------- store rows

describe("MemoryStore recurrence rows", () => {
  let store: MemoryStore;
  beforeAll(() => {
    store = new MemoryStore(":memory:", "rows-user");
  });
  afterAll(() => store.close());

  /** End a session carrying these mistake ids, with a back-dated recording. */
  function dated(sessionId: string, language: string, mistakeIds: string[], recordedAt: string) {
    const sid = store.createSession(language, "en", sessionId);
    store.endSession(sid, "s", reviewWith(mistakeIds.map((m) => item(m))));
    store.db
      .prepare(`UPDATE session_mistakes SET recorded_at = ? WHERE session_id = ?`)
      .run(recordedAt, sid);
    return sid;
  }

  it("(b) the same mistake twice in ONE old session counts as 1 prior session", () => {
    dated("dup-old", "de", ["de-perf-haben-sein", "de-perf-haben-sein"], "2026-10-10T08:00:00.000Z");
    const h = store.mistakeHistory("de-perf-haben-sein", "some-later-session");
    expect(h.priorSessions).toBe(1);
    expect(h.firstDate).toBe("2026-10-10T08:00:00.000Z");
  });

  it("(b) appearing in 3 different sessions counts 3, and firstDate is the earliest", () => {
    dated("trip-1", "de", ["de-article-feminine"], "2026-10-15T08:00:00.000Z");
    dated("trip-2", "de", ["de-article-feminine"], "2026-10-16T08:00:00.000Z");
    dated("trip-3", "de", ["de-article-feminine"], "2026-10-17T08:00:00.000Z");
    const h = store.mistakeHistory("de-article-feminine", "current-session");
    expect(h.priorSessions).toBe(3);
    expect(h.firstDate).toBe("2026-10-15T08:00:00.000Z");
  });

  it("the current session is excluded, so the count is strictly PRIOR", () => {
    dated("only-self", "en", ["en-depend-prep"], "2026-10-20T08:00:00.000Z");
    expect(store.mistakeHistory("en-depend-prep", "only-self")).toEqual({
      priorSessions: 0,
      firstDate: null,
    });
  });

  it("re-ending a session does not double-count it (PK + INSERT OR IGNORE)", () => {
    const sid = store.createSession("es", "en", "re-end");
    const r = reviewWith([item("es-ser-estar-agree")]);
    store.endSession(sid, "a", r);
    store.endSession(sid, "b", r);
    expect(store.mistakeHistory("es-ser-estar-agree", "other").priorSessions).toBe(1);
  });

  it("rows are scoped to the account — another learner's history is not this one's habit", () => {
    const dir = mkdtempSync(join(tmpdir(), "sala-recurrence-"));
    const path = join(dir, "acct.db");
    try {
      const a = new MemoryStore(path, "acct-a");
      const sid = a.createSession("en", "en", "acct-a-session");
      a.endSession(sid, "s", reviewWith([item("en-married-prep")]));
      a.close();
      const b = new MemoryStore(path, "acct-b");
      expect(b.listSessions()).toEqual([]);
      expect(b.mistakeHistory("en-married-prep", "x")).toEqual({ priorSessions: 0, firstDate: null });
      b.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no row is written for an item that had no identity", () => {
    const sid = store.createSession("en", "en", "no-id-session");
    store.endSession(
      sid,
      "s",
      reviewWith([{ point: "orphan", example: "x", correction: "y", explanation: "z" }]),
    );
    expect(store.mistakeHistory("orphan", "x").priorSessions).toBe(0);
  });
});

// ------------------------------------------------------ end-to-end over MCP

describe("end_session recurrence over MCP (Echo, offline, sequential sessions)", () => {
  let httpServer: http.Server;
  let memory: MemoryStore;
  let client: Client;

  const MISTAKE_TURN = "Yesterday I go to climbing wall with my friend Daniel.";

  async function callTool(name: string, args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError, `${name} errored: ${JSON.stringify(result.content)}`).toBeFalsy();
    return {
      structured: (result.structuredContent ?? {}) as Record<string, unknown>,
      text: (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join(""),
    };
  }

  type Gram = {
    point: string;
    mistakeId?: string;
    recurrence?: { seenInSessions: number; firstDate: string };
  };
  const reviewOf = (s: Record<string, unknown>) => s.review as { grammar: Gram[]; summary: string };

  async function endSessionWithMistakeTurn() {
    const { structured: chatRes } = await callTool("chat", {
      message: MISTAKE_TURN,
      targetLanguage: "en",
    });
    return callTool("end_session", { sessionId: chatRes.sessionId as string });
  }

  beforeAll(async () => {
    memory = new MemoryStore(":memory:", "recurrence-mcp-user");
    httpServer = createSalaHttpServer({ memory, llm: new EchoLLM() });
    httpServer.listen(0, "127.0.0.1");
    await once(httpServer, "listening");
    const addr = httpServer.address();
    if (typeof addr === "string" || addr === null) throw new Error("no address");
    client = new Client({ name: "recurrence-test", version: "0.1.0" });
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

  it("(c) first session on an empty DB: no recurrence field, no summary sentence", async () => {
    const { structured, text } = await endSessionWithMistakeTurn();
    expect(structured.extractionPath).toBe("heuristic");
    const review = reviewOf(structured);
    expect(review.grammar.length).toBeGreaterThan(0);
    for (const g of review.grammar) {
      expect(typeof g.mistakeId).toBe("string");
      expect("recurrence" in g).toBe(false); // not 1, not "first time" — nothing
    }
    expect(review.summary).not.toMatch(/made before|first logged|earlier session/);
    expect(text).not.toMatch(/made before|first logged/);
  });

  it("second session, same error class: counted from real rows, clause in the summary", async () => {
    const startedAt = Date.now();
    const { structured, text } = await endSessionWithMistakeTurn();
    const review = reviewOf(structured);
    expect(review.grammar.length).toBeGreaterThan(0);
    for (const g of review.grammar) {
      expect(g.recurrence?.seenInSessions, `${g.point} seen in 2 sessions`).toBe(2);
      expect(g.recurrence?.firstDate).toBeTypeOf("string");
    }
    const day = review.summary.match(/first logged on (\d{4}-\d{2}-\d{2})\.$/);
    expect(review.summary).toMatch(
      /2 of these are mistakes you've made before, first logged on \d{4}-\d{2}-\d{2}\.$/,
    );
    // the date in the sentence is a real stored session (today), not a constant
    expect(day && Date.parse(day[1])).toBeLessThanOrEqual(startedAt + 1000);
    // the same claim is in the human-readable payload, not only structuredContent
    expect(text).toContain("mistakes you've made before");
  });

  it("third session: the count grows, so it is a count and not a constant", async () => {
    const { structured } = await endSessionWithMistakeTurn();
    for (const g of reviewOf(structured).grammar) {
      expect(g.recurrence?.seenInSessions).toBe(3);
    }
  });

  it("a mistake only THIS session made stays unrecurred", async () => {
    const { structured: chatRes } = await callTool("chat", {
      message: "She work out every day before the gym opens.",
      targetLanguage: "en",
    });
    const { structured } = await callTool("end_session", {
      sessionId: chatRes.sessionId as string,
    });
    const review = reviewOf(structured);
    expect(review.grammar.map((g) => g.mistakeId)).toContain("en-third-person-s");
    for (const g of review.grammar) {
      if (g.mistakeId === "en-third-person-s") expect("recurrence" in g).toBe(false);
    }
    expect(review.summary).not.toMatch(/made before|first logged/);
  });

  it("list_sessions still validates, carrying the stored recurrence", async () => {
    const { structured } = await callTool("list_sessions");
    const sessions = structured.sessions as Array<{
      id: string;
      date: string;
      language: string;
      summary: string | null;
      review: { vocabulary: unknown[]; grammar: Gram[]; summary: string } | null;
    }>;
    expect(sessions).toHaveLength(4);
    const withRec = sessions.filter((s) => s.review?.grammar.some((g) => g.recurrence));
    expect(withRec).toHaveLength(2); // sessions 2 and 3 (list is newest-first)
    expect(
      withRec
        .map((s) => Math.max(...s.review!.grammar.map((g) => g.recurrence?.seenInSessions ?? 0)))
        .sort((x, y) => x - y),
    ).toEqual([2, 3]);
    // the audit trail matches the claim: the sentence is in the stored summary too
    expect(withRec[0].summary).toMatch(/mistakes you've made before, first logged on/);
    expect(sessions[0].review!.grammar.every((g) => !g.recurrence)).toBe(true);
  });
});
