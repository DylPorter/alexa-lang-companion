/**
 * Swappable LLM backend protocol (same shape proven in firetv-factcheck's
 * verify_agent.py, clean-room reimplementation by the same author).
 *
 * One method: turn a system prompt + message history into raw text.
 * `phase` scopes the call ("chat" | "review") for logging and token budgets.
 */

/**
 * Prompt-protocol marker: the server appends a `<<RECALLED>>` block to the chat
 * system prompt ONLY when it genuinely retrieved stored facts. Backends (Echo)
 * and tests key off this marker; its presence is the honesty contract for
 * memoryReferenced.
 */
export const RECALL_MARKER = "<<RECALLLED>>";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LLM {
  readonly name: "echo" | "proxy" | "bedrock";
  invoke(phase: "chat" | "review", system: string, messages: ChatMessage[]): Promise<string>;
}

export function maxTokensFor(phase: "chat" | "review"): number {
  return phase === "chat" ? 512 : 2048;
}
