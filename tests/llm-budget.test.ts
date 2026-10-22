/**
 * Regression guard for the silent money-shot degradation (found 2026-10-22).
 *
 * Reasoning-tuned backends spend max_tokens on the `thinking` block before any text
 * arrives. At the old review budget of 2048 the review pass returned
 * stop_reason=max_tokens with NO text block; ProxyLLM filtered to text, got "", and
 * extractReview fell back to the heuristic panel without saying so. Two of three
 * live money-shot sessions were the weak table before anyone could see why.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maxTokensFor } from "../src/llm/types.js";
import { ProxyLLM } from "../src/llm/proxy.js";

describe("output budget has to cover the thinking block", () => {
  it("gives review enough headroom to finish a real review after reasoning", () => {
    // Measured: ~2.0k thinking + ~1.7k text to reach end_turn on the EN fixture.
    expect(maxTokensFor("review")).toBeGreaterThanOrEqual(8192);
  });

  it("gives chat headroom too — the empty-reply retries were the same cut", () => {
    expect(maxTokensFor("chat")).toBeGreaterThanOrEqual(2048);
  });
});

describe("ProxyLLM says out loud when a completion carries no text", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function stubFetch(json: unknown) {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(json), { status: 200 })) as never;
  }

  it("warns with the stop reason and names the budget when thinking ate it", async () => {
    stubFetch({ stop_reason: "max_tokens", content: [{ type: "thinking", thinking: "…" }] });
    const llm = new ProxyLLM("http://127.0.0.1:9", "test-key", "test-model");
    expect(await llm.invoke("review", "sys", [{ role: "user", content: "hi" }])).toBe("");
    const line = vi.mocked(console.warn).mock.calls.flat().join(" ");
    expect(line).toContain("phase=review");
    expect(line).toContain("stop_reason=max_tokens");
    expect(line).toContain("raise maxTokensFor");
  });

  it("still warns on a genuine empty completion, without blaming the budget", async () => {
    stubFetch({ stop_reason: "end_turn", content: [] });
    const llm = new ProxyLLM("http://127.0.0.1:9", "test-key", "test-model");
    await llm.invoke("chat", "sys", [{ role: "user", content: "hi" }]);
    const line = vi.mocked(console.warn).mock.calls.flat().join(" ");
    expect(line).toContain("stop_reason=end_turn");
    expect(line).not.toContain("raise maxTokensFor");
  });

  it("does not warn when text actually arrives", async () => {
    stubFetch({ stop_reason: "end_turn", content: [{ type: "text", text: '{"vocabulary":[]}' }] });
    const llm = new ProxyLLM("http://127.0.0.1:9", "test-key", "test-model");
    expect(await llm.invoke("review", "sys", [{ role: "user", content: "hi" }])).toContain("vocabulary");
    expect(console.warn).not.toHaveBeenCalled();
  });
});
