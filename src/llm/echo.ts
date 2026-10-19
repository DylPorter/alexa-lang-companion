/**
 * EchoLLM — deterministic offline backend for the test suite.
 *
 * Chat replies are canned-but-coherent English (the demo-first language; Echo
 * is a test double, not the persona showcase). When the prompt carries a
 * `<<RECALLED>>` block (the server only inserts one when it genuinely retrieved
 * stored facts), the reply references the first recalled item verbatim, so
 * integration tests can assert memoryReferenced behaviour end-to-end.
 *
 * The review phase is NOT modelled here: review extraction has a deterministic
 * heuristic path (src/review/extract.ts) that runs for every backend; the LLM
 * review pass is an enhancement only ProxyLLM/BedrockLLM add.
 */
import { ChatMessage, LLM, RECALL_MARKER } from "./types.js";

export { RECALL_MARKER };

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
