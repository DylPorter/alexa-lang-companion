/**
 * MCP protocol-level integration test (SPEC A1 acceptance).
 *
 * Drives chat → log_activity → recall → end_session → list_sessions through a
 * REAL MCP SDK client over Streamable HTTP against the real Sala server with
 * EchoLLM + an in-memory SQLite DB. Fully offline, zero network.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createSalaHttpServer } from "../src/server/http.js";
import { MemoryStore } from "../src/memory/db.js";
import { EchoLLM } from "../src/llm/echo.js";

let httpServer: http.Server;
let memory: MemoryStore;
let llm: EchoLLM;
let client: Client;
let baseUrl: string;

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<{
  structured: Record<string, unknown>;
  text: string;
}> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, `tool ${name} returned error: ${JSON.stringify(result.content)}`).toBeFalsy();
  const text = (result.content as Array<{ type: string; text?: string }>)
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
  return { structured: (result.structuredContent ?? {}) as Record<string, unknown>, text };
}

beforeAll(async () => {
  memory = new MemoryStore(":memory:", "integration-user");
  llm = new EchoLLM();
  httpServer = createSalaHttpServer({ memory, llm });
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const addr = httpServer.address();
  if (typeof addr === "string" || addr === null) throw new Error("no address");
  baseUrl = `http://127.0.0.1:${addr.port}`;

  client = new Client({ name: "sala-integration-test", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
});

afterAll(async () => {
  await client?.close();
  httpServer?.close();
  await once(httpServer, "close").catch(() => undefined);
  memory?.close();
});

describe("MCP surface", () => {
  it("exposes exactly the 5 SPEC tools over Streamable HTTP", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "chat",
      "end_session",
      "list_sessions",
      "log_activity",
      "recall",
    ]);
    for (const t of tools) {
      expect(t.inputSchema).toBeDefined();
      expect(t.description?.length ?? 0).toBeGreaterThan(20);
    }
  });

  it("GET /health reports the backend without leaking env values", async () => {
    const resp = await fetch(`${baseUrl}/health`);
    expect(resp.ok).toBe(true);
    expect(await resp.json()).toEqual({ ok: true, backend: "echo" });
  });
});

describe("full session lifecycle (SPEC demo flow shape)", () => {
  let sessionId: string;

  it("chat #1: new session, no memory yet → memoryReferenced false (honesty)", async () => {
    const { structured } = await callTool("chat", {
      message: "Hi Sala! How are you?",
      targetLanguage: "en",
    });
    expect(typeof structured.reply).toBe("string");
    expect((structured.reply as string).length).toBeGreaterThan(0);
    expect(structured.memoryReferenced).toBe(false); // nothing stored — must NOT pretend
    expect(structured.isNewSession).toBe(true);
    sessionId = structured.sessionId as string;
    expect(sessionId).toBeTruthy();
  });

  it("log_activity stores what the user did, returns an id", async () => {
    const { structured } = await callTool("log_activity", {
      text: "went bouldering at the climbing wall, fell on the blue route twice",
    });
    expect(typeof structured.id).toBe("number");
  });

  it("recall finds the logged activity by keyword (FTS5)", async () => {
    const { structured } = await callTool("recall", { query: "bouldering climbing" });
    const activities = structured.activities as Array<{ text: string }>;
    expect(activities.length).toBeGreaterThan(0);
    expect(activities[0].text).toContain("climbing wall");
  });

  it("chat #2: recalled memory is genuinely referenced (memoryReferenced true)", async () => {
    const { structured } = await callTool("chat", {
      message: "I am so tired from the climbing session today",
      sessionId,
      targetLanguage: "en",
    });
    expect(structured.memoryReferenced).toBe(true);
    expect(structured.isNewSession).toBe(false);
    // EchoLLM references the first recalled fact verbatim — the reply proves
    // the recall block reached the model prompt.
    expect(structured.reply as string).toMatch(/I remember/i);
    expect(structured.reply as string).toContain("climbing wall");
  });

  it("chat #3-#5: the learner tells their day WITH real mistakes (fixture-grade)", async () => {
    await callTool("chat", {
      message: "Yesterday I go to climbing wall with my friend Daniel.",
      sessionId,
    });
    await callTool("chat", {
      message: "It was difficult but I am agree with Daniel: we need more practice.",
      sessionId,
    });
    await callTool("chat", {
      message: "Next time depend of the weather. He work out every day, so he is strong.",
      sessionId,
    });
  });

  it("end_session returns a review derived from what was ACTUALLY said", async () => {
    const { structured } = await callTool("end_session", { sessionId });
    const review = structured.review as {
      vocabulary: Array<{ word: string; example: string }>;
      grammar: Array<{ point: string; example: string; correction: string; explanation: string }>;
      summary: string;
    };
    expect(structured.extractionPath).toBe("heuristic"); // EchoLLM → deterministic path

    // 4-6 vocab items; every example is the learner's OWN sentence from this session
    expect(review.vocabulary.length).toBeGreaterThanOrEqual(4);
    expect(review.vocabulary.length).toBeLessThanOrEqual(6);
    const saidThisSession = [
      "Yesterday I go to climbing wall with my friend Daniel.",
      "It was difficult but I am agree with Daniel: we need more practice.",
      "Next time depend of the weather. He work out every day, so he is strong.",
    ];
    for (const item of review.vocabulary) {
      expect(
        saidThisSession.some((s) => s.includes(item.example)),
        `vocab example not from this session's actual messages: "${item.example}"`,
      ).toBe(true);
    }

    // 1-2 grammar points tied to observed mistakes, with the learner's sentence shown
    expect(review.grammar.length).toBeGreaterThanOrEqual(1);
    expect(review.grammar.length).toBeLessThanOrEqual(2);
    const corrections = review.grammar.map((g) => g.correction.toLowerCase());
    expect(corrections).toContain("i went"); // tense mistake from chat #3
    for (const g of review.grammar) {
      expect(saidThisSession.some((s) => s.includes(g.example))).toBe(true);
    }

    expect(review.summary.length).toBeGreaterThan(10);
  });

  it("list_sessions shows the ended session with its stored review (state across sessions)", async () => {
    const { structured } = await callTool("list_sessions");
    const sessions = structured.sessions as Array<{
      id: string;
      date: string;
      language: string;
      summary: string | null;
      review: unknown;
    }>;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(sessionId);
    expect(sessions[0].language).toBe("en");
    expect(sessions[0].summary).toBeTruthy();
    expect(sessions[0].review).not.toBeNull();
  });

  it("chat in a NEW session remembers the old one (cross-session memory beat)", async () => {
    const { structured } = await callTool("chat", {
      message: "Do you remember my climbing plans?",
      targetLanguage: "en",
    });
    expect(structured.isNewSession).toBe(true);
    expect(structured.memoryReferenced).toBe(true); // past-session messages matched via FTS5
    const sid2 = structured.sessionId as string;
    const { structured: list } = await callTool("list_sessions");
    expect((list.sessions as unknown[]).length).toBe(2);
    // end the second session too: empty-ish learner content → honest review, no crash
    const { structured: end2 } = await callTool("end_session", { sessionId: sid2 });
    expect((end2.review as { summary: string }).summary).toBeTruthy();
  });

  it("end_session on an unknown session errors cleanly", async () => {
    const result = await client.callTool({
      name: "end_session",
      arguments: { sessionId: "no-such-session" },
    });
    expect(result.isError).toBe(true);
  });
});

describe("protocol-level honesty checks", () => {
  it("chat passed every turn through the persona prompt (no bare completion)", () => {
    expect(llm.calls.length).toBeGreaterThan(0);
    for (const call of llm.calls) {
      expect(call.phase).toBe("chat");
      expect(call.system).toContain("Sala");
      expect(call.system).toMatch(/NOT a tutor/i);
    }
  });
});
