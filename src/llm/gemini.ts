/**
 * GeminiLLM — bring-your-own-key backend against the Google Gemini API
 * (`generativelanguage.googleapis.com` v1beta `:generateContent`).
 *
 * Shapes verified 2026-10-23 against two primary sources, not from memory:
 *   · the machine-readable discovery document (revision 20261019) for the request
 *     and response fields — `systemInstruction`/`contents` as `Content{role,parts}`,
 *     `generationConfig.maxOutputTokens`/`temperature`, `Part.text` + `Part.thought`,
 *     `Candidate.finishReason` (… MAX_TOKENS, SAFETY …) and `promptFeedback`;
 *   · ai.google.dev/gemini-api/docs for the auth header (`x-goog-api-key`) and the
 *     key env vars — `GEMINI_API_KEY` or `GOOGLE_API_KEY`, where the docs state
 *     "If both are set, GOOGLE_API_KEY takes precedence", which is why the lookup
 *     order here is GOOGLE first (matching Google's own client libraries).
 *
 * Deliberately NOT sent: any thinking/reasoning field. The discovery schema marks
 * `thinkingConfig.thinkingLevel` as "Recommended for Gemini 3 or later models. Use
 * with earlier models results in an error", and `thinkingBudget` errors on models
 * without thinking — so the one flag that is safe across every id is "send neither"
 * and let the model use its documented default (dynamic thinking, sized to request
 * complexity). If the review pass is too slow on a live key, that is a measured
 * change to make, not a guess to ship. See docs/LATENCY.md for how the Anthropic
 * path earned its thinking-off default.
 *
 * The key goes in a header, never in the URL: a `?key=` query string lands in
 * proxies' and browsers' access logs, and this repo already has one incident on
 * record of a Gemini tool printing an API key (see the vault reference note on
 * Gemini CLI). Nothing here logs the value.
 */
import { byokModelFor, ChatMessage, LLM, maxTokensFor } from "./types.js";

/** The id Google's own text-generation examples use today. Override via SALA_MODEL / GEMINI_MODEL. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

export const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Google's documented key lookup: GOOGLE_API_KEY wins when both are set. First
 * NON-EMPTY, same reasoning as ProxyLLM (shells export empty assignments).
 */
export function geminiKeyFrom(env: NodeJS.ProcessEnv = process.env): string {
  return (
    [env.GOOGLE_API_KEY, env.GEMINI_API_KEY].find((v) => v && v.length > 0) ?? ""
  ).trim();
}

export class GeminiLLM implements LLM {
  readonly name = "gemini" as const;
  readonly baseUrl: string;
  private readonly key: string;
  private readonly model: string;
  /** True when the caller injected a model id — then no env override may fire. */
  private readonly modelWasInjected: boolean;

  constructor(baseUrl?: string, apiKey?: string, model?: string) {
    this.baseUrl = (
      baseUrl ??
      process.env.GEMINI_BASE_URL ??
      DEFAULT_GEMINI_BASE_URL
    ).replace(/\/+$/, "");
    this.key = (apiKey ?? geminiKeyFrom()).trim();
    if (!this.key) {
      throw new Error(
        "GeminiLLM requires GEMINI_API_KEY (or GOOGLE_API_KEY) — a key from " +
          "aistudio.google.com, pasted into .env or exported. Never commit it.",
      );
    }
    this.modelWasInjected = model !== undefined;
    this.model = model ?? byokModelFor("chat", DEFAULT_GEMINI_MODEL, process.env.GEMINI_MODEL);
  }

  /** Per-phase model id (SALA_REVIEW_MODEL / SALA_CHAT_MODEL), see docs/LATENCY.md. */
  modelFor(phase: "chat" | "review"): string {
    return this.modelWasInjected
      ? this.model
      : byokModelFor(phase, this.model, process.env.GEMINI_MODEL);
  }

  /**
   * The Gemini API rejects a whole request over one unsupported generationConfig
   * field, and a rejected request looks identical to "the model had nothing to
   * say" from the outside — which is precisely how the 2026-10-22 silent
   * heuristic degradation happened. So on a 400 we retry once with the optional
   * generation fields dropped, loudly, instead of letting the review fall back
   * quietly. Chat is always 0.7 and review 0; only review can be omitted.
   */
  async invoke(phase: "chat" | "review", system: string, messages: ChatMessage[]): Promise<string> {
    const model = this.modelFor(phase);
    const url = `${this.baseUrl}/models/${model}:generateContent`;
    const send = (withTemperature: boolean) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({
            // Gemini's roles are 'user' | 'model' — the discovery doc marks any
            // other value invalid, so the assistant→model mapping is mandatory.
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
          generationConfig: {
            maxOutputTokens: maxTokensFor(phase),
            ...(withTemperature
              ? { temperature: phase === "review" ? 0 : 0.7 }
              : {}),
          },
        }),
        signal: AbortSignal.timeout(150_000),
      });

    let resp = await send(true);
    if (resp.status === 400) {
      console.warn(
        `[llm] gemini rejected the request for model=${model} (HTTP 400); ` +
          `retrying once without the optional temperature field`,
      );
      resp = await send(false);
    }
    if (!resp.ok) {
      // Shapes only — an error body can echo request metadata.
      throw new Error(`GeminiLLM HTTP ${resp.status} ${resp.statusText} (model=${model})`);
    }

    const parsed = (await resp.json()) as {
      candidates?: Array<{
        finishReason?: string;
        content?: { parts?: Array<{ text?: string; thought?: boolean }> };
      }>;
      promptFeedback?: { blockReason?: string };
    };
    const candidate = parsed.candidates?.[0];
    // Filter thought parts: if a model ever returns them unsolicited, they must
    // not reach the review JSON parser or the learner's reply. Same intent as
    // ProxyLLM's `type === "text"` filter.
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === "string")
      .map((p) => p.text as string)
      .join("");
    if (!text) {
      const block = parsed.promptFeedback?.blockReason;
      console.warn(
        `[llm] gemini gave no text for phase=${phase} model=${model} ` +
          `finish_reason=${candidate?.finishReason ?? "?"}` +
          (block ? ` blocked=${block}` : "") +
          (candidate?.finishReason === "MAX_TOKENS"
            ? " — the budget cut it off, raise maxTokensFor"
            : ""),
      );
    }
    return text;
  }
}

/** True when a Gemini key is present — backend auto-selection + smoke gating. */
export function hasGeminiEnvCreds(env: NodeJS.ProcessEnv = process.env): boolean {
  return geminiKeyFrom(env).length > 0;
}
