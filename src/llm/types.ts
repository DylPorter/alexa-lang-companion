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

/**
 * Output budget per phase — and it is NOT a text-length budget. Reasoning-tuned
 * Anthropic-compatible backends (our qwen proxy, and Bedrock Nova when it thinks)
 * spend `max_tokens` on the `thinking` block before emitting any `text` block.
 *
 * Measured 2026-10-22 against the real review prompt: at the old 2048 the model
 * consumed all 2048 tokens on thinking, answered `stop_reason: max_tokens` with
 * **no text block at all**, and ProxyLLM's text filter turned that into an empty
 * reply — which fell back to the weak heuristic panel silently, on 2 of 3
 * money-shot sessions. At 8192 the identical call reached `end_turn` with
 * ~2.0k thinking + ~1.7k text. Chat hit the same wall at 512 (those
 * "[chat] empty LLM reply, retrying once" log lines were this, not the proxy).
 *
 * So: real headroom on both phases. You are billed for tokens actually produced,
 * not for the cap, so this costs nothing when the model is brief.
 */
export function maxTokensFor(phase: "chat" | "review"): number {
  return phase === "chat" ? 2048 : 8192;
}
