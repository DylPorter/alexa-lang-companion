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
  readonly name: "echo" | "proxy" | "bedrock" | "openai" | "gemini";
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
 * not for the cap, so this costs nothing when the model is brief. Review stays at
 * 8192 even after thinking switched off (see `thinkingForPhase`) — some gateways
 * ignore the flag, and a truncated review degrades SILENTLY to the heuristic panel.
 *
 * The same number is what every backend asks its provider for — `max_tokens` /
 * `max_completion_tokens` on the OpenAI lane, `maxOutputTokens` on Gemini — because
 * the truncation failure mode is provider-independent, even though the field names
 * are not. Keep them in sync here rather than per-backend.
 */
export function maxTokensFor(phase: "chat" | "review"): number {
  return phase === "chat" ? 2048 : 8192;
}

/**
 * Per-phase model override, so the extraction pass can run on a faster model
 * while the persona chat stays on the better one. Precedence:
 *   SALA_REVIEW_MODEL / SALA_CHAT_MODEL  (phase)
 *   > SALA_MODEL > ANTHROPIC_MODEL > the backend's own default.
 * A model id passed to a backend constructor is an explicit injection and wins
 * over all of it — that is what keeps the offline tests hermetic if the shell
 * happens to export one of these.
 */
export function modelForPhase(
  phase: "chat" | "review",
  fallback: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveModel(phase, fallback, env, env.ANTHROPIC_MODEL);
}

/**
 * Same per-phase precedence for a bring-your-own-key backend, minus the
 * Anthropic-specific legacy var, plus that provider's own model var:
 *   SALA_REVIEW_MODEL / SALA_CHAT_MODEL > SALA_MODEL > <PROVIDER>_MODEL > default.
 *
 * Why not just reuse modelForPhase: on this machine `ANTHROPIC_MODEL` is exported
 * by the harness (qwen3.8-flash), and handing that id to api.openai.com or
 * generativelanguage.googleapis.com is a 400 on a teammate's first call — the one
 * failure mode a BYOK path must not have. The provider var is passed in (not read
 * here) so the caller decides which name it honours, and a whitespace-only value
 * counts as unset exactly like the proxy path does.
 */
export function byokModelFor(
  phase: "chat" | "review",
  fallback: string,
  providerModel?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveModel(phase, fallback, env, providerModel);
}

function resolveModel(
  phase: "chat" | "review",
  fallback: string,
  env: NodeJS.ProcessEnv,
  providerVar?: string,
): string {
  const phaseKey = phase === "review" ? env.SALA_REVIEW_MODEL : env.SALA_CHAT_MODEL;
  return (
    (phaseKey ?? "").trim() ||
    (env.SALA_MODEL ?? "").trim() ||
    (providerVar ?? "").trim() ||
    fallback
  );
}

/**
 * Reasoning control per phase, as a spreadable request-body fragment. This gateway
 * thinks BY DEFAULT and bills those tokens against `max_tokens`, which is what made
 * the review pass take 22-50s.
 *
 * Measured 2026-10-23 against the real review prompt + real fixture, one call per
 * shape (`scripts/latency-probe.ts shapes`, full table in docs/LATENCY.md):
 *   no thinking field (old behaviour)   33.6s   blocks=[thinking:4535, text:1740]  out=1620
 *   thinking:{type:"disabled"}           5.7s   blocks=[text:1746]                 out=447, parses
 *   thinking:{enabled,budget 1024}      21.3s   blocks=[thinking:1944, text:1718]
 *   thinking:{enabled,budget 512}       24.2s   blocks=[thinking:1577, text:1730]
 *   enable_thinking:false               35.7s   IGNORED — still thinking:9007
 *   chat_template_kwargs:{…}            48.8s   IGNORED — thinking grew to 12180
 *
 * So only the Anthropic `thinking` field is honoured here; the OpenAI-style qwen
 * flags go through as unknown fields. The review is a deterministic extraction over
 * a transcript handed to it whole, so reasoning buys nothing there: off by default.
 * Chat is the persona, where quality IS the product, and it answers in ~3.4s: left
 * at the gateway default. Override with SALA_REVIEW_THINKING / SALA_CHAT_THINKING
 * = on | off | default.
 */
export function thinkingForPhase(
  phase: "chat" | "review",
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  const raw = (phase === "review" ? env.SALA_REVIEW_THINKING : env.SALA_CHAT_THINKING)
    ?.trim()
    .toLowerCase();
  const off = raw ? raw === "off" || raw === "false" : phase === "review";
  return off ? { thinking: { type: "disabled" } } : {};
}

