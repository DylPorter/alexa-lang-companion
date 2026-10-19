/**
 * MCP server surface — the 5 SPEC tools registered on a McpServer.
 *
 * Stateless per HTTP request (SPEC's memory story lives in SQLite, not in MCP
 * session state): buildSalaServer() returns a fresh McpServer wired to shared
 * deps. Conversation sessions (the `sessionId` in chat/end_session) are Sala
 * sessions — a separate concept from MCP transport sessions.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MemoryStore } from "../memory/db.js";
import { LLM, ChatMessage } from "../llm/types.js";
import { chatSystemPrompt } from "../persona/prompts.js";
import { extractReview } from "../review/extract.js";
import { ACCOUNT_ID, DEFAULT_NATIVE_LANGUAGE, DEFAULT_TARGET_LANGUAGE } from "../config.js";

export interface SalaDeps {
  memory: MemoryStore;
  llm: LLM;
}

/** Context lines fed to the persona prompt from a genuine recall. */
function recallContextLines(
  r: ReturnType<MemoryStore["recall"]>,
): string[] {
  const lines: string[] = [];
  for (const a of r.activities) {
    const when = new Date(a.when).toDateString() === new Date().toDateString() ? "today" : `on ${a.when.slice(0, 10)}`;
    lines.push(`The user logged (${when}): "${a.text}"`);
  }
  for (const s of r.pastSessions) {
    if (s.matchedMessage) {
      lines.push(`In a past session (${s.date.slice(0, 10)}) the user said: "${s.matchedMessage}"`);
    } else if (s.summary) {
      lines.push(`Past session (${s.date.slice(0, 10)}): ${s.summary}`);
    }
  }
  return lines;
}

// ---- shared output schemas (typed contract for the A2 sim + client validation)
const activitySchema = z.object({
  id: z.number(),
  text: z.string(),
  when: z.string(),
  createdAt: z.string(),
});
const pastSessionSchema = z.object({
  id: z.string(),
  date: z.string(),
  language: z.string(),
  summary: z.string().nullable(),
  matchedMessage: z.string().optional(),
});
const vocabItemSchema = z.object({
  word: z.string(),
  example: z.string(),
  note: z.string().optional(),
});
const grammarItemSchema = z.object({
  point: z.string(),
  example: z.string(),
  correction: z.string(),
  explanation: z.string(),
});
const reviewSchema = z.object({
  vocabulary: z.array(vocabItemSchema),
  grammar: z.array(grammarItemSchema),
  summary: z.string(),
});

export function buildSalaServer(deps: SalaDeps): McpServer {
  const { memory, llm } = deps;
  const server = new McpServer(
    { name: "sala-lang-companion", version: "0.1.0" },
    {
      instructions:
        "Sala — a living-room language companion that remembers your life. " +
        "Call chat for conversation, log_activity when the user shares something they did, " +
        "recall for transparency into stored memory, end_session to generate the session review, " +
        "list_sessions to see conversation history.",
    },
  );

  // -------------------------------------------------------------------- chat
  server.registerTool(
    "chat",
    {
      title: "Chat with Sala",
      description:
        "One conversational turn: Sala replies in the target language as a friend, " +
        "with at most one gentle recast correction, weaving in genuinely recalled " +
        "personal context. memoryReferenced is true ONLY when stored facts were " +
        "actually retrieved and offered to the model.",
      inputSchema: {
        message: z.string().min(1).describe("The user's message (any language)"),
        sessionId: z
          .string()
          .optional()
          .describe("Sala session id; omit to start a new session (returned in the reply meta)"),
        targetLanguage: z
          .string()
          .optional()
          .describe('BCP-47-ish code for the language Sala speaks, e.g. "en", "fr", "de". Default "en".'),
      },
      outputSchema: {
        reply: z.string(),
        sessionId: z.string(),
        memoryReferenced: z.boolean(),
        isNewSession: z.boolean(),
      },
    },
    async ({ message, sessionId, targetLanguage }) => {
      const language = targetLanguage ?? DEFAULT_TARGET_LANGUAGE;
      let sid = sessionId;
      let isNewSession = false;
      if (!sid || !memory.getSession(sid)) {
        sid = memory.createSession(language, DEFAULT_NATIVE_LANGUAGE, sid);
        isNewSession = true;
      }
      memory.addMessage(sid, "user", message);

      // Genuine recall only: FTS over stored activities + OTHER sessions' messages.
      const recalled = memory.recall({ query: message, limit: 4, excludeSessionId: sid });
      const contextLines = recallContextLines(recalled);
      const memoryReferenced = contextLines.length > 0;

      const system = chatSystemPrompt(
        { targetLanguage: language, nativeLanguage: DEFAULT_NATIVE_LANGUAGE },
        contextLines,
      );
      const history: ChatMessage[] = memory
        .getTranscript(sid)
        .slice(0, -1) // exclude the just-stored current message; sent explicitly below
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.content }));
      history.push({ role: "user", content: message });

      let reply = (await llm.invoke("chat", system, history)).trim();
      if (!reply) {
        // Live proxies occasionally return empty content (observed on the qwen
        // proxy, 2026-10-20): one retry, then an honest fallback — never pretend.
        console.warn("[chat] empty LLM reply, retrying once");
        reply = (await llm.invoke("chat", system, history)).trim();
      }
      if (!reply) {
        reply = "Sorry — I lost my words for a second. Could you say that again?";
      }
      memory.addMessage(sid, "assistant", reply);

      return {
        structuredContent: {
          reply,
          sessionId: sid,
          memoryReferenced,
          isNewSession,
        },
        content: [{ type: "text" as const, text: reply }],
      };
    },
  );

  // ------------------------------------------------------------ log_activity
  server.registerTool(
    "log_activity",
    {
      title: "Log an activity",
      description:
        "Store something the user did or is doing (told to the companion), timestamped. " +
        "This is the memory that chat later recalls.",
      inputSchema: {
        text: z.string().min(1).describe("What the user did / is doing, in natural language"),
        when: z
          .string()
          .optional()
          .describe("ISO timestamp of when it happened; defaults to now"),
      },
      outputSchema: {
        id: z.number(),
      },
    },
    async ({ text, when }) => {
      const activity = memory.logActivity(text, when);
      return {
        structuredContent: { id: activity.id },
        content: [{ type: "text" as const, text: `Logged activity #${activity.id}.` }],
      };
    },
  );

  // ------------------------------------------------------------------ recall
  server.registerTool(
    "recall",
    {
      title: "Recall stored memory",
      description:
        "FTS5 keyword search + recency over the user's logged activities and past " +
        "sessions. Exposed for transparency — this is exactly what chat uses internally.",
      inputSchema: {
        query: z.string().optional().describe("Keywords; omit for most-recent material"),
        since: z.string().optional().describe("ISO date lower bound"),
        limit: z.number().int().min(1).max(20).optional().describe("Max items per list (default 5)"),
      },
      outputSchema: {
        activities: z.array(activitySchema),
        pastSessions: z.array(pastSessionSchema),
      },
    },
    async ({ query, since, limit }) => {
      const result = memory.recall({ query, since, limit });
      return {
        structuredContent: { ...result } as unknown as Record<string, unknown>,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  // -------------------------------------------------------------- end_session
  server.registerTool(
    "end_session",
    {
      title: "End session + generate review",
      description:
        "The money shot: closes the session and returns a review — vocabulary and " +
        "1-2 grammar points derived EXCLUSIVELY from what the learner actually said " +
        "(their own sentences as examples), plus a summary. Stored with the session.",
      inputSchema: {
        sessionId: z.string().describe("The Sala session id returned by chat"),
      },
      outputSchema: {
        review: reviewSchema,
        extractionPath: z.enum(["heuristic", "llm"]),
      },
    },
    async ({ sessionId }) => {
      const session = memory.getSession(sessionId);
      if (!session) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Unknown session: ${sessionId}` }],
        };
      }
      const transcript = memory
        .getTranscript(sessionId)
        .map((m) => ({ role: m.role, content: m.content }));
      const { review, path } = await extractReview(
        transcript,
        { targetLanguage: session.language, nativeLanguage: DEFAULT_NATIVE_LANGUAGE },
        llm,
      );
      memory.endSession(sessionId, review.summary, review);
      return {
        structuredContent: { review, extractionPath: path },
        content: [{ type: "text" as const, text: JSON.stringify(review, null, 2) }],
      };
    },
  );

  // ------------------------------------------------------------ list_sessions
  server.registerTool(
    "list_sessions",
    {
      title: "List past sessions",
      description:
        'The "remembers every conversation" proof: every past session with date, ' +
        "language, summary, and its stored review.",
      inputSchema: {},
      outputSchema: {
        sessions: z.array(
          z.object({
            id: z.string(),
            date: z.string(),
            language: z.string(),
            summary: z.string().nullable(),
            review: reviewSchema.nullable(),
          }),
        ),
      },
    },
    async () => {
      const sessions = memory.listSessions().map((s) => ({
        id: s.id,
        date: s.date,
        language: s.language,
        summary: s.summary,
        review: s.review,
      }));
      return {
        structuredContent: { sessions },
        content: [{ type: "text" as const, text: JSON.stringify(sessions, null, 2) }],
      };
    },
  );

  return server;
}

export { ACCOUNT_ID };
