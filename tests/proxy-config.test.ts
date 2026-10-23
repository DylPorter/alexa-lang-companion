/**
 * Per-phase LLM request configuration (docs/LATENCY.md).
 *
 * Two things the latency work depends on, pinned offline with a stubbed fetch:
 *  1. `SALA_REVIEW_MODEL` / `SALA_CHAT_MODEL` reach the wire per phase, and a
 *     constructor-injected model id wins over an exported env var — that is what
 *     keeps every other test in this suite hermetic if a dev shell happens to
 *     export one of them.
 *  2. the review phase asks the gateway to stop reasoning (measured win: 33.6-50s
 *     → 5.7s on the real prompt), the chat phase sends no thinking field at all,
 *     and the OpenAI-style qwen flags are NOT sent because this gateway ignores
 *     them (35.7s / 48.8s, thinking block still present).
 *
 * No network. `npm test` must stay runnable inside a network namespace.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modelForPhase, thinkingForPhase } from "../src/llm/types.js";
import { ProxyLLM } from "../src/llm/proxy.js";

/** The env parameter exists so these resolution tests never mutate process.env. */
describe("modelForPhase: per-phase model routing", () => {
  it("prefers the phase override over the shared and legacy vars", () => {
    const env = {
      SALA_REVIEW_MODEL: "small-fast-model",
      SALA_CHAT_MODEL: "good-persona-model",
      SALA_MODEL: "shared-model",
      ANTHROPIC_MODEL: "legacy-model",
    };
    expect(modelForPhase("review", "backend-default", env)).toBe("small-fast-model");
    expect(modelForPhase("chat", "backend-default", env)).toBe("good-persona-model");
  });

  it("falls back to SALA_MODEL, then ANTHROPIC_MODEL, then the backend default", () => {
    expect(modelForPhase("review", "backend-default", { SALA_MODEL: "shared-model" })).toBe(
      "shared-model",
    );
    expect(
      modelForPhase("review", "backend-default", { ANTHROPIC_MODEL: "legacy-model" }),
    ).toBe("legacy-model");
    expect(modelForPhase("review", "backend-default", {})).toBe("backend-default");
  });

  it("treats an empty or whitespace override as unset (a blank .env line must not 400)", () => {
    expect(modelForPhase("review", "backend-default", { SALA_REVIEW_MODEL: "  ", SALA_MODEL: "shared" })).toBe(
      "shared",
    );
    expect(modelForPhase("review", "backend-default", { SALA_REVIEW_MODEL: "" })).toBe(
      "backend-default",
    );
  });
});

describe("thinkingForPhase: only the Anthropic `thinking` field is sent", () => {
  it("disables reasoning on the extraction pass by default", () => {
    expect(thinkingForPhase("review", {})).toEqual({ thinking: { type: "disabled" } });
  });

  it("leaves the persona pass at the gateway default (sends no field)", () => {
    expect(thinkingForPhase("chat", {})).toEqual({});
  });

  it("honours the per-phase escape hatches", () => {
    // Reviewer depth A/B, and taking the chat out of reasoning for more speed.
    expect(thinkingForPhase("review", { SALA_REVIEW_THINKING: "on" })).toEqual({});
    expect(thinkingForPhase("chat", { SALA_CHAT_THINKING: "off" })).toEqual({
      thinking: { type: "disabled" },
    });
    expect(thinkingForPhase("review", { SALA_REVIEW_THINKING: "false" })).toEqual({
      thinking: { type: "disabled" },
    });
    // "default" means the gateway's own default (which IS reasoning on this proxy),
    // not Sala's shipped default — spelled out because the two differ for review.
    expect(thinkingForPhase("review", { SALA_REVIEW_THINKING: "default" })).toEqual({});
  });

  it("never smuggles an OpenAI-style flag through — measured to be ignored here", () => {
    for (const body of [thinkingForPhase("review", {}), thinkingForPhase("chat", {})]) {
      expect(body).not.toHaveProperty("enable_thinking");
      expect(body).not.toHaveProperty("chat_template_kwargs");
    }
  });
});

describe("ProxyLLM request body carries the per-phase config", () => {
  const originalFetch = globalThis.fetch;
  let sent: Record<string, unknown>[] = [];

  beforeEach(() => {
    sent = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }),
        { status: 200 },
      );
    }) as never;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    delete process.env.SALA_MODEL;
    delete process.env.SALA_REVIEW_MODEL;
    delete process.env.SALA_CHAT_MODEL;
  });

  const llm = () => new ProxyLLM("http://127.0.0.1:9", "test-key");

  it("sends SALA_REVIEW_MODEL on review and SALA_CHAT_MODEL on chat", async () => {
    process.env.SALA_MODEL = "shared-model";
    process.env.SALA_REVIEW_MODEL = "fast-extract-model";
    process.env.SALA_CHAT_MODEL = "persona-model";
    const backend = llm();
    await backend.invoke("review", "sys", [{ role: "user", content: "hi" }]);
    await backend.invoke("chat", "sys", [{ role: "user", content: "hi" }]);
    expect(sent[0]?.model).toBe("fast-extract-model");
    expect(sent[1]?.model).toBe("persona-model");
  });

  it("uses the shared id for both phases when no override is set", async () => {
    process.env.SALA_MODEL = "shared-model";
    const backend = llm();
    await backend.invoke("review", "sys", [{ role: "user", content: "hi" }]);
    await backend.invoke("chat", "sys", [{ role: "user", content: "hi" }]);
    expect(sent[0]?.model).toBe("shared-model");
    expect(sent[1]?.model).toBe("shared-model");
  });

  it("lets an injected model id beat an exported override (test hermeticity)", () => {
    process.env.SALA_REVIEW_MODEL = "from-env";
    const backend = new ProxyLLM("http://127.0.0.1:9", "test-key", "injected-model");
    expect(backend.modelFor("review")).toBe("injected-model");
    expect(backend.modelFor("chat")).toBe("injected-model");
  });

  it("sends thinking:disabled for review and no thinking field for chat", async () => {
    const backend = llm();
    await backend.invoke("review", "sys", [{ role: "user", content: "hi" }]);
    await backend.invoke("chat", "sys", [{ role: "user", content: "hi" }]);
    expect(sent[0]?.thinking).toEqual({ type: "disabled" });
    expect(sent[1]).not.toHaveProperty("thinking");
  });

  it("keeps the temperature and budget contract per phase", async () => {
    const backend = llm();
    await backend.invoke("review", "sys", [{ role: "user", content: "hi" }]);
    await backend.invoke("chat", "sys", [{ role: "user", content: "hi" }]);
    // Review stays deterministic AND keeps the 8192 headroom: the budget is what
    // stopped a truncated review degrading silently to the heuristic panel
    // (tests/llm-budget.test.ts), and a cap costs nothing when the model is brief.
    expect(sent[0]?.temperature).toBe(0);
    expect(sent[0]?.max_tokens).toBeGreaterThanOrEqual(8192);
    expect(sent[1]?.temperature).toBe(0.7);
    expect(sent[1]?.max_tokens).toBeGreaterThanOrEqual(2048);
  });

  it("never puts key material in the body it logs or sends as a field", async () => {
    const backend = llm();
    await backend.invoke("review", "sys", [{ role: "user", content: "hi" }]);
    expect(JSON.stringify(sent[0])).not.toContain("test-key");
  });
});
