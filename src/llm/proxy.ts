/**
 * ProxyLLM — Anthropic-compatible /v1/messages against a proxy (ANTHROPIC_BASE_URL),
 * e.g. the local qwen dev proxy. Same header dance proven in firetv-factcheck:
 * ANTHROPIC_API_KEY wins, ANTHROPIC_AUTH_TOKEN is the fallback; when both hold the
 * same value, send x-api-key AND Authorization: Bearer (proxies read one or the
 * other). NEVER mix differing values, never log key material.
 */
import { ChatMessage, LLM, maxTokensFor } from "./types.js";

export class ProxyLLM implements LLM {
  readonly name = "proxy" as const;
  private readonly base: string;
  private readonly key: string;
  private readonly model: string;

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
    this.model =
      model ?? process.env.SALA_MODEL ?? process.env.ANTHROPIC_MODEL ?? "qwen3.8-flash";
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
        model: this.model,
        max_tokens: maxTokensFor(phase),
        temperature: phase === "review" ? 0 : 0.7,
        system,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) {
      // Do not include response body blindly — it can echo request headers.
      throw new Error(`ProxyLLM HTTP ${resp.status} ${resp.statusText}`);
    }
    const body = (await resp.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    return (body.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
  }
}
