/**
 * MemoryStore unit tests — SQLite + FTS5 keyword recall + recency ordering
 * (SPEC: no embeddings). In-memory DB, fully offline.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore, toFtsQuery } from "../src/memory/db.js";

let store: MemoryStore;

beforeEach(() => {
  store = new MemoryStore(":memory:", "test-user");
});
afterEach(() => store.close());

describe("activities + FTS5 recall", () => {
  it("logs activities and finds them by keyword", () => {
    const a = store.logActivity("went bouldering at the climbing gym");
    expect(a.id).toBeGreaterThan(0);
    const r = store.recall({ query: "climbing" });
    expect(r.activities).toHaveLength(1);
    expect(r.activities[0].text).toContain("climbing gym");
  });

  it("is accent-insensitive (unicode61 remove_diacritics)", () => {
    store.logActivity("visité le cinéma avec ma sœur");
    expect(store.recall({ query: "cinema" }).activities).toHaveLength(1);
    expect(store.recall({ query: "visite" }).activities).toHaveLength(1);
    expect(store.recall({ query: "cine" }).activities).toHaveLength(0); // prefix ≠ match without *
    // known limitation (honest): œ is a LIGATURE, not a diacritic — unicode61's
    // remove_diacritics can't fold it to "oe", so "soeur" does NOT match "sœur".
    expect(store.recall({ query: "soeur" }).activities).toHaveLength(0);
    expect(store.recall({ query: "sœur" }).activities).toHaveLength(1);
  });

  it("neutralizes FTS operator characters instead of throwing", () => {
    store.logActivity("meeting with the team");
    expect(() => store.recall({ query: 'team AND (boss OR "client") NOT intern' })).not.toThrow();
    expect(store.recall({ query: "team*" }).activities.length).toBeGreaterThanOrEqual(0);
  });

  it("orders no-query recall by recency", () => {
    store.logActivity("older thing about chess");
    store.logActivity("newer thing about chess");
    const r = store.recall({});
    expect(r.activities[0].text).toContain("newer");
  });

  it("respects since and limit", () => {
    const past = new Date(Date.now() - 7 * 86400_000).toISOString();
    store.logActivity("last week hiking", past);
    store.logActivity("today coding");
    const since = new Date(Date.now() - 86400_000).toISOString();
    expect(store.recall({ since }).activities.map((a) => a.text)).toEqual(["today coding"]);
    expect(store.recall({ limit: 1 }).activities).toHaveLength(1);
  });
});

describe("sessions + transcripts", () => {
  it("creates, lists and ends sessions with a stored review", () => {
    const sid = store.createSession("fr", "en");
    store.addMessage(sid, "user", "Hier j'ai allé au cinéma.");
    store.addMessage(sid, "assistant", "Tu es allé au cinéma !");
    const transcript = store.getTranscript(sid);
    expect(transcript.map((m) => m.role)).toEqual(["user", "assistant"]);

    store.endSession(sid, "Talked about cinema.", {
      vocabulary: [{ word: "le cinéma", example: "Hier j'ai allé au cinéma." }],
      grammar: [],
      summary: "Talked about cinema.",
    });
    const s = store.getSession(sid);
    expect(s?.endedAt).not.toBeNull();
    expect(s?.review?.vocabulary[0].word).toBe("le cinéma");

    const list = store.listSessions();
    expect(list).toHaveLength(1);
    expect(list[0].summary).toBe("Talked about cinema.");
  });

  it("recall finds past-session messages but excludes the live session", () => {
    const s1 = store.createSession("en", "en");
    store.addMessage(s1, "user", "I trained for the marathon every morning");
    store.endSession(s1, "marathon talk", { vocabulary: [], grammar: [], summary: "marathon talk" });

    const s2 = store.createSession("en", "en");
    store.addMessage(s2, "user", "marmoning update about the marathon");

    const r = store.recall({ query: "marathon", excludeSessionId: s2 });
    expect(r.pastSessions.map((p) => p.id)).toEqual([s1]);
    expect(r.pastSessions[0].matchedMessage).toContain("marathon");
  });

  it("no-query recall returns ended past sessions most-recent first", () => {
    const s1 = store.createSession("en", "en");
    store.endSession(s1, "first", { vocabulary: [], grammar: [], summary: "first" });
    const s2 = store.createSession("en", "en");
    store.endSession(s2, "second", { vocabulary: [], grammar: [], summary: "second" });
    const r = store.recall({ excludeSessionId: "whatever" });
    expect(r.pastSessions.map((p) => p.summary)).toEqual(["second", "first"]);
  });
});

describe("toFtsQuery", () => {
  it("quotes tokens and ORs them, dropping short noise", () => {
    expect(toFtsQuery("Climbing, with Daniel!")).toBe('"climbing" OR "with" OR "daniel"');
    expect(toFtsQuery("a b ?")).toBeNull();
  });
});
