/**
 * OpenAILLM — bring-your-own-key backend against any OpenAI-compatible
 * `/chat/completions` endpoint. This is the path a teammate runs on their own
 * account with no AWS enablement and no gateway: one key, one env var.
 *
 * Because the surface is "OpenAI-compatible" rather than "OpenAI", the request
 * body is deliberately narrow: `model`, `messages`, one output-budget field and
 * (when the id accepts it) `temperature`. Anthropic-only fields (`system` as a
 * top-level key, `thinking`) are NOT sent here — a gateway that validates its
 * schema rejects unknown keys with a 400, and the failure lands on the person
 * holding the key, not on whoever wrote the client.
 *
 * Two provider facts drive the per-model branching (both read out of OpenAI's own
 * openapi.yaml on 2026-10-23, not remembered):
 *   1. `max_tokens` is deprecated in favour of `max_completion_tokens` and is
 *      documented as "not compatible with o-series models". The old name is still
 *      what third-party compatible servers expect, so neither field is universally
 *      right — pick it from the model id, the same way bedrock.ts picks
 *      temperature by id rather than by a flag.
 *   2. `temperature` has no documented supported range for the reasoning ids, so
 *      for those we omit the field and take the model's own default. Sending a
 *      literal that happens to be unsupported is a 400 for a teammate.
 *
 * Credentials come from OPENAI_API_KEY and are never logged, never put in a URL
 * query string, and never echoed into an error message.
 *
 * Offline tests stub `fetch` and construct this class directly — no network.
 */
import { byokModelFor, ChatMessage, LLM, maxTokensFor } from "./types.js";

/**
 * A cheap, non-reasoning id that appears in OpenAI's current model enum, so a
 * fresh key can call it without a waitlist and both the token field and
 * temperature 0 are accepted. Override with SALA_MODEL / OPENAI_MODEL — the
 * truth about *your* key is `GET {base}/models`, and the README says so.
 */
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

/** Default public endpoint; OPENAI_BASE_URL replaces it for any compatible server. */
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

/**
 * True for the reasoning families (o1/o3/o4-…, gpt-5 and later majors), which is
 * where `max_completion_tokens` is required and `temperature` is not ours to set.
 * Deliberately shaped so `gpt-4o-mini` does NOT match: its `o-mini` suffix is the
 * old completion-style naming, and it accepts both fields.
 */
export function isReasoningModelId(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return /(^|[^a-z0-9])o[0-9]/.test(id) || /gpt-[5-9]/.test(id);
}

/** Which output-budget field this id accepts — see the header comment. */
export function maxTokensFieldFor(modelId: string): "max_tokens" | "max_completion_tokens" {
  return isReasoningModelId(modelId) ? "max_completion_tokens" : "max_tokens";
}

/**
 * Temperature for one phase, or undefined to omit it (reasoning ids: no
 * documented supported range, so the model default is the only safe value).
 * Review stays deterministic wherever the provider accepts that.
 */
export function openaiTemperatureFor(phase: "chat" | "review", modelId: string): number | undefined {
  if (isReasoningModelId(modelId)) return undefined;
  return phase === "review" ? 0 : 0.7;
}

export class OpenAILLM implements LLM {
  readonly name = "openai" as const;
  readonly baseUrl: string;
  private readonly key: string;
  private readonly model: string;
  /** True when the caller injected a model id — then no env override may fire. */
  private readonly modelWasInjected: boolean;

  constructor(baseUrl?: string, apiKey?: string, model?: string) {
    this.baseUrl = (
      baseUrl ??
      process.env.OPENAI_BASE_URL ??
      DEFAULT_OPENAI_BASE_URL
    ).replace(/\/+$/, "");
    this.key =
      [apiKey, process.env.OPENAI_API_KEY].find((v) => v && v.length > 0) ?? "";
    if (!this.key) {
      // Names, not values: this string ends up on a teammate's screen, and the
      // shape of the ask has to be obvious from it.
      throw new Error(
        "OpenAILLM requires OPENAI_API_KEY (your own key from platform.openai.com → " +
          "API keys; for a local OpenAI-compatible server such as Ollama or LM Studio any " +
          "non-empty value works, e.g. OPENAI_API_KEY=local)",
      );
    }
    this.modelWasInjected = model !== undefined;
    this.model =
      model ?? byokModelFor("chat", DEFAULT_OPENAI_MODEL, process.env.OPENAI_MODEL);
  }

  /** Per-phase model id (SALA_REVIEW_MODEL / SALA_CHAT_MODEL), see docs/LATENCY.md. */
  modelFor(phase: "chat" | "review"): string {
    return this.modelWasInjected
      ? this.model
      : byokModelFor(phase, this.model, process.env.OPENAI_MODEL);
  }

  async invoke(phase: "chat" | "review", system: string, messages: ChatMessage[]): Promise<string> {
    const model = this.modelFor(phase);
    const temperature = openaiTemperatureFor(phase, model);
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: system },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      [maxTokensFieldFor(model)]: maxTokensFor(phase),
    };
    if (temperature !== undefined) body.temperature = temperature;

    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.key}`,
      },
      body: JSON.stringify(body),
      // Same contract as ProxyLLM: fail here with a named error rather than let
      // the sim's 180 s tool timeout fire over a call that is still running.
      signal: AbortSignal.timeout(150_000),
    });
    if (!resp.ok) {
      // No response body — it can echo request headers, which carry the key.
      throw new Error(
        `OpenAILLM HTTP ${resp.status} ${resp.statusText}` +
          (resp.status === 404 || resp.status === 400
            ? ` — check the model id (${model}) against your own key: ` +
              `curl -s -H "Authorization: Bearer $OPENAI_API_KEY" ${this.baseUrl}/models`
            : ""),
      );
    }
    const parsed = (await resp.json()) as {
      choices?: Array<{
        finish_reason?: string;
        message?: { content?: string | Array<{ type?: string; text?: string }> };
      }>;
    };
    const choice = parsed.choices?.[0];
    const text = flattenContent(choice?.message?.content);
    if (!text) {
      // Mirrors the proxy lesson from 2026-10-22: an empty completion is otherwise
      // indistinguishable from "the model had nothing to say", which is how a
      // truncated review degraded to the heuristic panel silently for two days.
      const finish = choice?.finish_reason ?? "?";
      console.warn(
        `[llm] openai gave no text for phase=${phase} model=${model} finish_reason=${finish}` +
          (finish === "length" ? " — raise maxTokensFor (or point SALA_REVIEW_MODEL at a shorter model)" : ""),
      );
    }
    return text;
  }
}

/**
 * OpenAI returns `content` as a string; several compatible servers return the
 * array-of-parts shape instead. Accept both, keep only text, in order.
 */
export function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && typeof p === "object")
      .filter((p) => (p as { type?: string }).type === undefined || (p as { type?: string }).type === "text")
      .map((p) => (p as { text?: string }).text ?? "")
      .join("");
  }
  return "";
}

/** True when an OpenAI key is present — backend auto-selection + smoke gating. */
export function hasOpenaiEnvCreds(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean((env.OPENAI_API_KEY ?? "").trim());
}
