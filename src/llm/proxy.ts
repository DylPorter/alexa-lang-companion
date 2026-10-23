/**
 * ProxyLLM — Anthropic-compatible /v1/messages against a proxy (ANTHROPIC_BASE_URL),
 * e.g. the local qwen dev proxy. Same header dance proven in firetv-factcheck:
 * ANTHROPIC_API_KEY wins, ANTHROPIC_AUTH_TOKEN is the fallback; when both hold the
 * same value, send x-api-key AND Authorization: Bearer (proxies read one or the
 * other). NEVER mix differing values, never log key material.
 */
import { ChatMessage, LLM, maxTokensFor, modelForPhase, thinkingForPhase } from "./types.js";

export class ProxyLLM implements LLM {
  readonly name = "proxy" as const;
  private readonly base: string;
  private readonly key: string;
  private readonly model: string;
  /** True when the caller injected a model id — then no env override may fire. */
  private readonly modelWasInjected: boolean;

  constructor(baseUrl?: string, apiKey?: string, model?: string) {
    this.base = (baseUrl ?? process.env.ANTHROPIC_BASE_URL ?? "").replace(/\/+$/, "");
    if (!this.base) throw new Error("ProxyLLM requires ANTHROPIC_BASE_URL");
    // First NON-EMPTY wins: shells (and Claude Code's settings.json) often export
    // ANTHROPIC_API_KEY as an empty string alongside a real ANTHROPIC_AUTH_TOKEN.
    this.key =
      [apiKey, process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_AUTH_TOKEN]
        .find((v) => v && v.length > 0) ?? "";
    if (!this.key) {
      throw new Error("ProxyLLM requires ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN)");
    }
    this.modelWasInjected = model !== undefined;
    this.model =
      model ?? process.env.SALA_MODEL ?? process.env.ANTHROPIC_MODEL ?? "qwen3.8-flash";
  }

  /**
   * The model id for one phase. Per-phase routing (docs/LATENCY.md) lets the
   * end-of-session extraction run on a cheaper/faster model while the persona
   * chat stays on the good one: SALA_REVIEW_MODEL / SALA_CHAT_MODEL. Unset, both
   * phases use the default id, so behaviour is unchanged.
   */
  modelFor(phase: "chat" | "review"): string {
    return this.modelWasInjected ? this.model : modelForPhase(phase, this.model);
  }

  async invoke(phase: "chat" | "review", system: string, messages: ChatMessage[]): Promise<string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": this.key,
    };
    const bearer = process.env.ANTHROPIC_AUTH_TOKEN ?? "";
    if (bearer && bearer === this.key) headers["authorization"] = `Bearer ${this.key}`;

    const resp = await fetch(`${this.base}/v1/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        // Per-phase model id (SALA_REVIEW_MODEL / SALA_CHAT_MODEL), defaulting to
        // the backend's own id — see modelFor() and docs/LATENCY.md.
        model: this.modelFor(phase),
        max_tokens: maxTokensFor(phase),
        temperature: phase === "review" ? 0 : 0.7,
        // Measured 2026-10-23: disabling reasoning on the extraction pass takes it
        // from 33.6s-50s to 5.7s (thinking is billed against max_tokens and this call
        // has nothing to reason about). Chat sends no thinking field at all, so the
        // persona keeps the gateway default; SALA_CHAT_THINKING=off takes the persona
        // out of reasoning too if you want the extra speed on camera. See docs/LATENCY.md.
        ...thinkingForPhase(phase),
        system,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
      // 150s, under the sim's 180s tool timeout, so a slow gateway fails here with
      // a named error instead of the client timing out over a still-running call.
      signal: AbortSignal.timeout(150_000),
    });
    if (!resp.ok) {
      // Do not include response body blindly — it can echo request headers.
      throw new Error(`ProxyLLM HTTP ${resp.status} ${resp.statusText}`);
    }
    const body = (await resp.json()) as {
      content?: Array<{ type?: string; text?: string }>;
      stop_reason?: string;
    };
    const blocks = body.content ?? [];
    const text = blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    if (!text) {
      // Shapes and the stop reason only — never the response body, which can echo
      // request headers. Without this line an empty completion is indistinguishable
      // from "the model had nothing to say", which is how the thinking-budget cut
      // (see maxTokensFor) hid for two days as a silent heuristic fallback.
      console.warn(
        `[llm] proxy gave no text for phase=${phase} stop_reason=${body.stop_reason ?? "?"} ` +
          `blocks=${JSON.stringify(blocks.map((b) => `${b.type}:${(b.text ?? "").length}`))}` +
          (body.stop_reason === "max_tokens" ? " — thinking ate the budget, raise maxTokensFor" : ""),
      );
    }
    return text;
  }
}
