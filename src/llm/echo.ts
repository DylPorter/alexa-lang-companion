/**
 * EchoLLM — deterministic offline backend for the test suite.
 *
 * Chat replies are canned-but-coherent English (the demo-first language; Echo
 * is a test double, not the persona showcase). When the prompt carries a
 * `<<RECALLED>>` block (the server only inserts one when it genuinely retrieved
 * stored facts), the reply references the first recalled item verbatim, so
 * integration tests can assert memoryReferenced behaviour end-to-end. When it
 * carries a `<<PENDING_FOLLOW_UPS>>` block the reply asks about that event, and
 * quotes the stored turn — Echo is allowed to quote it because the quote IS the
 * stored row; the live persona is told not to read the learner's words back at
 * them, because that is how a friend sounds nothing like a database.
 *
 * The review phase is NOT modelled here: review extraction has a deterministic
 * heuristic path (src/review/extract.ts) that runs for every backend; the LLM
 * review pass is an enhancement only the live backends (Proxy/Bedrock/OpenAI/Gemini) add.
 */
import { ChatMessage, LLM, CONTINUITY_MARKER, FOLLOW_UP_MARKER, RECALL_MARKER } from "./types.js";

export { CONTINUITY_MARKER, FOLLOW_UP_MARKER, RECALL_MARKER };

/** One parsed follow-up line from the prompt block (see `followUpBlock`). */
interface ParsedFollowUp {
  topic: string;
  saidOn: string;
  quote: string;
}

/**
 * Read the machine-readable follow-up lines back out of a system prompt. Echo is a
 * test double, so the format is the contract: `- <topic> · <yyyy-mm-dd> · "<verbatim>"`.
 */
export function parseFollowUpLines(system: string): ParsedFollowUp[] {
  const idx = system.indexOf(FOLLOW_UP_MARKER);
  if (idx === -1) return [];
  const out: ParsedFollowUp[] = [];
  for (const line of system.slice(idx).split("\n")) {
    const m = /^-\s+([a-z][a-z-]*)\s+·\s+(\d{4}-\d{2}-\d{2})\s+·\s+"(.+)"$/.exec(line.trim());
    if (m) out.push({ topic: m[1]!, saidOn: m[2]!, quote: m[3]! });
  }
  return out;
}

export class EchoLLM implements LLM {
  readonly name = "echo" as const;

  /** Every (phase, system) seen, for assertions. */
  readonly calls: Array<{ phase: string; system: string; messages: ChatMessage[] }> = [];

  async invoke(phase: "chat" | "review", system: string, messages: ChatMessage[]): Promise<string> {
    this.calls.push({ phase, system, messages });
    if (phase === "review") {
      // Honest deterministic fallback: the heuristic extractor never asks EchoLLM
      // for a review, so reaching here is a wiring bug — say so instead of inventing.
      return "REVIEW_UNAVAILABLE_IN_ECHO_MODE";
    }
    return this.chatReply(system, messages);
  }

  private chatReply(system: string, messages: ChatMessage[]): string {
    const last = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const lower = last.toLowerCase();

    // Follow-up beat (cross-session follow-ups) first: the server only puts the block on the message
    // that OPENS a session, so this is the "welcome back, how did it go" line —
    // deterministic proof of it without a live model, which is what the offline
    // `SALA_LLM=echo` QA replay and the test suite assert on.
    const [followUp] = parseFollowUpLines(system);
    if (followUp) {
      return `Welcome back! How did the ${followUp.topic} go? You said on ${followUp.saidOn}: "${followUp.quote}" — tell me about it.`;
    }

    // Continuity beat: the standing history block, if this learner has ended sessions.
    // Like the follow-up beat, Echo says the bytes out loud — proof for the offline
    // replay that a new session is NOT starting blank. The live persona is told the
    // opposite: to let the history shape the question instead of reciting it.
    const contIdx = system.indexOf(CONTINUITY_MARKER);
    if (contIdx !== -1) {
      const line = system
        .slice(contIdx)
        .split("\n")
        .find((l) => l.startsWith("- "));
      if (line) return `Picking up where we left off — ${line.slice(2).trim()}`;
    }

    // Memory beat: reference the first genuinely recalled item.
    const recallIdx = system.indexOf(RECALL_MARKER);
    if (recallIdx !== -1) {
      const firstLine = system
        .slice(recallIdx + RECALL_MARKER.length)
        .split("\n")
        .map((l) => l.replace(/^[-*]\s*/, "").trim())
        .find((l) => l.length > 0);
      if (firstLine) {
        return `Hey, good to see you! I remember: ${firstLine}. How did that go? Tell me about your day.`;
      }
    }

    if (/^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(lower)) {
      return "Hey! How are you today? What did you get up to?";
    }
    if (/\?$/.test(last.trim())) {
      return "Good question — I don't know everything, but I'm interested in what YOU think. How was your day?";
    }
    if (/\b(yesterday|today|tomorrow|this morning|this evening)\b/.test(lower)) {
      return "Interesting! Tell me more — what happened next?";
    }
    return "I see. Tell me more about that — how did it feel?";
  }
}
