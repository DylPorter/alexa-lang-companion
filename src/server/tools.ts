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
import { detectLanguageSwitch, languageName, normalizeLanguageCode } from "../persona/languages.js";
import { finishSession } from "./session.js";
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

/**
 * A pending cross-session follow-up as the client sees it (cross-session follow-ups). `quote` is the
 * learner's OWN turn out of the `followups` table — this is the field that proves Sala
 * is quoting a memory rather than generating one, which is why it travels to the client
 * instead of staying inside the prompt.
 */
const followUpSchema = z.object({
  topic: z.string(),
  quote: z.string(),
  /** When the learner said it (ISO, from the transcript row). */
  saidAt: z.string(),
  /** The language the quote arrived in — the reply itself is in the current one. */
  language: z.string(),
});

/** One standing grammar habit, counted from `session_mistakes` rows. */
const focusSchema = z.object({
  mistakeId: z.string(),
  label: z.string(),
  /** DISTINCT past sessions — never the live one, whose rows do not exist yet. */
  sessions: z.number().int().min(2),
  lastDate: z.string(),
});

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
/**
 * Cross-session recurrence of one grammar point (issue #2). OPTIONAL on purpose:
 * reviews stored before `session_mistakes` existed must still validate, and an
 * item with no earlier rows gets NO field at all rather than `seenInSessions: 1`.
 * Declared here because the MCP SDK validates `structuredContent` against
 * `outputSchema` — an undeclared field would be a protocol error, not a free add.
 */
const recurrenceSchema = z.object({
  /**
   * DISTINCT sessions carrying this `mistakeId`, INCLUDING the one being ended —
   * so ≥ 2 whenever present. Counted from real `session_mistakes` rows by
   * `MemoryStore.mistakeHistory`, never inferred.
   */
  seenInSessions: z.number().int().min(1),
  /** When this identity was first recorded (ISO, from the earliest stored row). */
  firstDate: z.string(),
});
const grammarItemSchema = z.object({
  point: z.string(),
  example: z.string(),
  correction: z.string(),
  explanation: z.string(),
  /** Stable mistake identity — the exact key recurrence counts on (`canonicalMistakeId`). */
  mistakeId: z.string().optional(),
  recurrence: recurrenceSchema.optional(),
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
        "Call chat for conversation — it opens a new session by asking how the thing the " +
        "user was waiting for went, and works harder on the grammar habits that keep " +
        "coming back. Call log_activity when the user shares something they did, " +
        "recall for transparency into stored memory, end_session to generate the session review, " +
        "list_sessions to see conversation history, set_language to change which language " +
        "Sala speaks for the rest of a session (or let `chat` notice it in the words).",
    },
  );

  // -------------------------------------------------------------------- chat
  server.registerTool(
    "chat",
    {
      title: "Chat with Sala",
      description:
        "One conversational turn: Sala replies in the session's language as a friend, " +
        "with at most one gentle recast correction, weaving in genuinely recalled " +
        "personal context. memoryReferenced is true ONLY when stored facts were " +
        "actually retrieved and offered to the model. The learner can change language by " +
        "asking for it in the message ('let's speak French') — the session then continues " +
        "in that language and the reply says so in `language`/`languageChanged`; pass " +
        "`targetLanguage` to set it without the words being understood here. " +
        "A message that OPENS a session also picks up anything the learner said they were " +
        "waiting for in an earlier session (`followUps`) — Sala asks how it went, once — and " +
        "every turn is told which grammar habits have recurred across past sessions, so it " +
        "works on those harder without ever saying so.",
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
        /** The language Sala is now speaking — it can differ from the stored one. */
        language: z.string(),
        /** True when THIS message asked to change language and the session followed. */
        languageChanged: z.boolean(),
        /** Same value as `language`, spelled out, so a client never needs its own table. */
        languageName: z.string(),
        /**
         * What Sala was handed to ask about on THIS turn (cross-session follow-ups): the verbatim
         * learner quotes from earlier sessions that are still pending. Non-empty only
         * on the message that opened a session, and only once per event — a row that
         * was already offered never comes back here.
         */
        followUps: z.array(followUpSchema),
      },
    },
    async ({ message, sessionId, targetLanguage }) => {
      let sid = sessionId;
      let isNewSession = false;
      if (!sid || !memory.getSession(sid)) {
        sid = memory.createSession(targetLanguage ?? DEFAULT_TARGET_LANGUAGE, DEFAULT_NATIVE_LANGUAGE, sid);
        isNewSession = true;
      }
      const session = memory.getSession(sid);
      // The session's STORED language is the truth for a continuing conversation. The
      // old code fell back to DEFAULT_TARGET_LANGUAGE on every turn that omitted
      // `targetLanguage`, so a French session silently snapped back to English after
      // one turn — which is exactly what a speaker-driven demo must not do.
      const previousLanguage = session?.language ?? targetLanguage ?? DEFAULT_TARGET_LANGUAGE;

      // The WORDS win over an explicit `targetLanguage`. That parameter is the default a
      // device carried into the turn — the sim sends its picker value on the message that
      // opens a session — not an instruction live in that moment. Detection is not a
      // stray mention (it needs a request shape, see `detectLanguageSwitch`), so letting
      // it win costs nothing: a learner whose FIRST words are "let's speak Spanish" means
      // Spanish. Reversing these two lines was issue #4: the model answered in Spanish
      // while `language` stayed "en", so the pill, the picker, the DB tag and the TTS
      // voice all contradicted the reply on screen.
      const explicit = targetLanguage?.trim();
      const nextLanguage =
        detectLanguageSwitch(message)?.code ??
        (explicit ? (normalizeLanguageCode(explicit) ?? explicit) : previousLanguage);
      const switched = nextLanguage !== previousLanguage;
      if (switched) memory.setSessionLanguage(sid, nextLanguage);

      // Tagged with the language it arrived in: the request to switch was spoken in the
      // OLD language, and Sala's answer in the new one. That is what makes a mixed
      // session legible to the review at the end.
      memory.addMessage(sid, "user", message, previousLanguage);

      // Genuine recall only: FTS over stored activities + OTHER sessions' messages.
      const recalled = memory.recall({ query: message, limit: 4, excludeSessionId: sid });
      const contextLines = recallContextLines(recalled);

      // Cross-session follow-up (cross-session follow-ups). The pending rows are read on the message
      // that OPENS a session and then marked offered, so an event gets ONE welcome-back
      // question rather than resurfacing for the rest of the learner's life. Marking
      // says "Sala was handed this", which is exactly what the row can prove; whether
      // the model then asked is in `reply`.
      const offered = isNewSession ? memory.pendingFollowUps({ excludeSessionId: sid }) : [];
      if (offered.length > 0) memory.markFollowUpsOffered(offered.map((f) => f.id), sid);
      // Standing habits (the recurrence half) are read on EVERY turn: the system
      // prompt is rebuilt each turn, so a once-per-session instruction would quietly
      // stop working after the first reply.
      const emphasis = memory.recurringMistakes({ language: nextLanguage, minSessions: 2 });

      // Both are stored rows handed to the model, so both light the "remembered" badge —
      // but they reach the client through their own fields, never folded into `recall`.
      const memoryReferenced = contextLines.length > 0 || offered.length > 0;

      const system = chatSystemPrompt(
        {
          targetLanguage: nextLanguage,
          nativeLanguage: DEFAULT_NATIVE_LANGUAGE,
          justSwitchedFrom: switched ? previousLanguage : undefined,
          followUps: offered.length > 0 ? offered : undefined,
          emphasis: emphasis.length > 0 ? emphasis : undefined,
        },
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
      memory.addMessage(sid, "assistant", reply, nextLanguage);

      return {
        structuredContent: {
          reply,
          sessionId: sid,
          memoryReferenced,
          isNewSession,
          language: nextLanguage,
          languageName: languageName(nextLanguage),
          languageChanged: switched,
          followUps: offered.map((f) => ({
            topic: f.topic,
            quote: f.quote,
            saidAt: f.saidAt,
            language: f.language,
          })),
        },
        content: [{ type: "text" as const, text: reply }],
      };
    },
  );

  // ------------------------------------------------------------- set_language
  server.registerTool(
    "set_language",
    {
      title: "Change the language Sala speaks",
      description:
        "Persist a new language for a live session — the same thing that happens when a " +
        "learner says \"let's speak French\", but asked directly. A capable client (Alexa+ " +
        "does the understanding) calls this after working out the intent; a client that " +
        "only forwards text still gets the switch, because `chat` recognises the request " +
        "in the message itself. Applies to the rest of the session: the persona, the " +
        "review at the end, and the device's voice. Codes outside the built-in name table " +
        "are accepted rather than refused — Sala then speaks whatever that code means to " +
        "the model, and the UI falls back to a browser voice.",
      inputSchema: {
        sessionId: z.string().describe("The Sala session id returned by chat"),
        language: z
          .string()
          .min(1)
          .describe('BCP-47-ish code ("fr", "de-DE") or a language name ("French", "français", "deutsch")'),
      },
      outputSchema: {
        sessionId: z.string(),
        previousLanguage: z.string(),
        language: z.string(),
        languageName: z.string(),
        changed: z.boolean(),
      },
    },
    async ({ sessionId, language }) => {
      const session = memory.getSession(sessionId);
      if (!session) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Unknown session: ${sessionId}` }],
        };
      }
      const next = normalizeLanguageCode(language) ?? language.trim();
      const changed = next !== session.language;
      if (changed) memory.setSessionLanguage(sessionId, next);
      const text = changed
        ? `Sala will speak ${languageName(next)} for the rest of this session.`
        : `Already speaking ${languageName(next)} — nothing changed.`;
      return {
        structuredContent: {
          sessionId,
          previousLanguage: session.language,
          language: next,
          languageName: languageName(next),
          changed,
        },
        content: [{ type: "text" as const, text }],
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
        "sessions. Exposed for transparency — this is exactly what chat uses internally. " +
        "Also lists what Sala is waiting to ask about (`followUps`, verbatim quotes) and " +
        "which grammar habits have recurred (`focus`, counted across sessions), because " +
        "those two drive the conversation and should be inspectable too. The last two " +
        "lists are small and complete: unlike `activities`/`pastSessions` they are NOT " +
        "filtered by `query` — 'what is Sala waiting to ask' has no keyword form.",
      inputSchema: {
        query: z.string().optional().describe("Keywords; omit for most-recent material"),
        since: z.string().optional().describe("ISO date lower bound"),
        limit: z.number().int().min(1).max(20).optional().describe("Max items per list (default 5)"),
      },
      outputSchema: {
        activities: z.array(activitySchema),
        pastSessions: z.array(pastSessionSchema),
        followUps: z.array(followUpSchema),
        focus: z.array(focusSchema),
      },
    },
    async ({ query, since, limit }) => {
      const result = memory.recall({ query, since, limit });
      const followUps = memory.pendingFollowUps({ limit: 10 });
      const focus = memory.recurringMistakes({ minSessions: 2, limit: 10 });
      const payload = { ...result, followUps, focus };
      return {
        structuredContent: payload as unknown as Record<string, unknown>,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(payload, null, 2),
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
        "(their own sentences as examples), plus a summary. Stored with the session. " +
        "A grammar point carries `mistakeId` (its stable identity) and, when the SAME " +
        "id is stored for an EARLIER session, `recurrence.seenInSessions` — a count of " +
        "distinct sessions including this one, read from real rows before they are " +
        "written. Recurred points are listed FIRST: the habit you have not fixed leads " +
        "the panel. A first-time mistake gets no `recurrence` field and no summary " +
        "sentence: nothing is asserted that the database does not hold. " +
        "Closing a session is also what PRESERVES it — anything the learner said they " +
        "were waiting for is stored verbatim and comes back as `followUps`, which the " +
        "next new session is handed as its opening question.",
      inputSchema: {
        sessionId: z.string().describe("The Sala session id returned by chat"),
      },
      outputSchema: {
        review: reviewSchema,
        extractionPath: z.enum(["heuristic", "llm"]),
        followUps: z.array(followUpSchema),
      },
    },
    async ({ sessionId }) => {
      const finished = await finishSession(memory, llm, sessionId);
      if (!finished) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Unknown session: ${sessionId}` }],
        };
      }
      const { review: ended, path, followUps } = finished;
      const blocks = [
        { type: "text" as const, text: JSON.stringify(ended, null, 2) },
        // Spoken-proof line: the follow-ups are the part of the money shot the viewer
        // cannot see in the review itself, so it goes in the human-readable payload too.
        ...(followUps.length > 0
          ? [
              {
                type: "text" as const,
                text: `Stored for next session: ${followUps
                  .map((f) => `${f.topic} — "${f.quote}"`)
                  .join("; ")}`,
              },
            ]
          : []),
      ];
      return {
        structuredContent: {
          review: ended,
          extractionPath: path,
          followUps,
        },
        content: blocks,
      };
    },
  );

  // ------------------------------------------------------------ list_sessions
  server.registerTool(
    "list_sessions",
    {
      title: "List past sessions",
      description:
        'The "remembers every conversation" proof: every past session with date, the ' +
        "language(s) it covered, summary, and its stored review.",
      inputSchema: {},
      outputSchema: {
        sessions: z.array(
          z.object({
            id: z.string(),
            date: z.string(),
            language: z.string(),
            /**
             * Every language the session actually covered, in order of appearance —
             * `["fr"]` for a French session, `["en", "fr"]` for one where the learner
             * asked to switch halfway. Equals `[language]` for sessions whose rows carry
             * no per-message tag (written before switching existed).
             */
            languages: z.array(z.string()),
            summary: z.string().nullable(),
            review: reviewSchema.nullable(),
          }),
        ),
      },
    },
    async () => {
      const list = memory.listSessions();
      const spoken = memory.languagesBySession(list.map((s) => s.id));
      const sessions = list.map((s) => ({
        id: s.id,
        date: s.date,
        language: s.language,
        languages: spoken[s.id]?.length ? spoken[s.id] : [s.language],
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
