/**
 * Bring-your-own-key backends (added 2026-10-23): OpenAILLM and GeminiLLM, plus
 * the selection order that has to put them below the two author-side backends.
 *
 * These are the lanes a teammate runs on his own account, so the pinning is about
 * first-call failure modes rather than model quality:
 *  · which env var must be set, and that a missing one fails with its NAME (not a
 *    silent Echo that looks like a working demo);
 *  · the request field each provider actually accepts — OpenAI deprecated
 *    `max_tokens` and rejects it on the reasoning ids, so the field is chosen per
 *    model id, and `temperature` is dropped rather than guessed for those;
 *  · that an Anthropic model id exported by the harness (ANTHROPIC_MODEL) never
 *    reaches an OpenAI or Gemini URL — that is a 400 on someone else's key;
 *  · the response shapes: `choices[0].message.content` as string OR parts array,
 *    Gemini's `role: "model"` mapping, and thought parts filtered out;
 *  · the 2026-10-22 lesson carried over: a completion with no text must say so
 *    with a finish reason, because a quiet empty reply degrades the review to the
 *    heuristic panel invisibly;
 *  · no key material in a URL, a body, or an error message.
 *
 * No network — `fetch` is stubbed. `npm test` must stay runnable in a network
 * namespace.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultLLM } from "../src/llm/index.js";
import {
  DEFAULT_OPENAI_MODEL,
  OpenAILLM,
  flattenContent,
  hasOpenaiEnvCreds,
  isReasoningModelId,
  maxTokensFieldFor,
  openaiTemperatureFor,
} from "../src/llm/openai.js";
import {
  DEFAULT_GEMINI_MODEL,
  GeminiLLM,
  geminiKeyFrom,
  hasGeminiEnvCreds,
} from "../src/llm/gemini.js";
import { maxTokensFor } from "../src/llm/types.js";

const ENV_KEYS = [
  "SALA_LLM",
  "SALA_MODEL",
  "SALA_CHAT_MODEL",
  "SALA_REVIEW_MODEL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_BASE_URL",
  "GEMINI_MODEL",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_BEARER_TOKEN_BEDROCK",
  "BEDROCK_MODEL",
  "AWS_DEFAULT_REGION",
  "AWS_REGION",
] as const;

describe("BYOK backends", () => {
  const saved: Record<string, string | undefined> = {};
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  /** Captures every request so assertions are about what went on the wire. */
  function stubFetch(handler: (n: number) => { status?: number; json: unknown }) {
    const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
    let n = 0;
    globalThis.fetch = vi.fn(async (url: unknown, init?: { body?: string; headers?: Record<string, string> }) => {
      n += 1;
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      const res = handler(n);
      return new Response(JSON.stringify(res.json), { status: res.status ?? 200 });
    }) as never;
    return calls;
  }

  const openaiReply = { choices: [{ finish_reason: "stop", message: { content: "hola" } }] };
  const geminiReply = {
    candidates: [{ finishReason: "STOP", content: { parts: [{ text: "hola" }] } }],
  };

  // ---------------------------------------------------------------- selection

  describe("defaultLLM selection order", () => {
    it("has no key at all → echo, the honest zero-config mode", () => {
      expect(defaultLLM().name).toBe("echo");
    });

    it("picks gemini and openai from a key alone", () => {
      process.env.GEMINI_API_KEY = "g";
      expect(defaultLLM().name).toBe("gemini");
      delete process.env.GEMINI_API_KEY;
      process.env.OPENAI_API_KEY = "o";
      expect(defaultLLM().name).toBe("openai");
    });

    it("ranks both BYOK lanes below AWS and the dev proxy", () => {
      process.env.OPENAI_API_KEY = "o";
      process.env.AWS_ACCESS_KEY_ID = "AKIDTEST";
      process.env.AWS_SECRET_ACCESS_KEY = "secret";
      // Bedrock stays first: the submission evidence must not depend on whether a
      // stray OpenAI key happens to be exported in the same shell.
      expect(defaultLLM().name).toBe("bedrock");
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:9";
      process.env.ANTHROPIC_AUTH_TOKEN = "t";
      expect(defaultLLM().name).toBe("proxy");
    });

    it("honours an explicit SALA_LLM over every credential", () => {
      process.env.SALA_LLM = "openai";
      process.env.OPENAI_API_KEY = "o";
      process.env.GEMINI_API_KEY = "g";
      process.env.AWS_ACCESS_KEY_ID = "AKIDTEST";
      process.env.AWS_SECRET_ACCESS_KEY = "secret";
      expect(defaultLLM().name).toBe("openai");
    });

    it("refuses an unknown SALA_LLM instead of falling through to echo", () => {
      // Echo answers confidently with canned English. A typo that silently selects
      // it turns a filmed demo into a rehearsal, so the typo has to be loud.
      process.env.SALA_LLM = "gpt";
      expect(() => defaultLLM()).toThrow(/not a backend/);
      expect(() => defaultLLM()).toThrow(/openai, gemini/);
      // The classic way to hit this branch is pasting a key into the wrong
      // variable, and the message must not read it back into a terminal
      // scrollback or a transcript.
      process.env.SALA_LLM = "sk-supersecret-shape";
      expect(() => defaultLLM()).toThrow(/not a backend/);
      expect(() => defaultLLM()).not.toThrow(/supersecret/);
    });

    it("names the env var when a forced BYOK backend has no key", () => {
      process.env.SALA_LLM = "openai";
      expect(() => defaultLLM()).toThrow(/OPENAI_API_KEY/);
      process.env.SALA_LLM = "gemini";
      expect(() => defaultLLM()).toThrow(/GEMINI_API_KEY/);
    });

    it("detects credential presence without throwing", () => {
      expect(hasOpenaiEnvCreds()).toBe(false);
      expect(hasGeminiEnvCreds()).toBe(false);
      expect(hasOpenaiEnvCreds({ OPENAI_API_KEY: "  " })).toBe(false);
      expect(hasGeminiEnvCreds({ GEMINI_API_KEY: "g" })).toBe(true);
    });
  });

  // ------------------------------------------------------------- id helpers

  describe("model-id keyed request fields", () => {
    it("treats the reasoning families as reasoning, and gpt-4o-mini as not", () => {
      expect(isReasoningModelId("o3-mini")).toBe(true);
      expect(isReasoningModelId("gpt-5.4-mini")).toBe(true);
      expect(isReasoningModelId(DEFAULT_OPENAI_MODEL)).toBe(false);
      expect(isReasoningModelId("gpt-4.1")).toBe(false);
      // Third-party compatible ids are not reasoning by default, so they keep the
      // widely-supported legacy field.
      expect(isReasoningModelId("qwen3.8-flash")).toBe(false);
      expect(isReasoningModelId("llama3.1-70b")).toBe(false);
    });

    it("sends max_completion_tokens only where max_tokens is rejected", () => {
      expect(maxTokensFieldFor(DEFAULT_OPENAI_MODEL)).toBe("max_tokens");
      expect(maxTokensFieldFor("o1")).toBe("max_completion_tokens");
      expect(maxTokensFieldFor("gpt-6-astra")).toBe("max_completion_tokens");
    });

    it("omits temperature for reasoning ids instead of guessing a supported value", () => {
      expect(openaiTemperatureFor("review", "gpt-4.1")).toBe(0);
      expect(openaiTemperatureFor("chat", "gpt-4.1")).toBe(0.7);
      expect(openaiTemperatureFor("chat", "o4-mini")).toBeUndefined();
      expect(openaiTemperatureFor("review", "gpt-5-nano")).toBeUndefined();
    });

    it("accepts both OpenAI content shapes", () => {
      expect(flattenContent("plain")).toBe("plain");
      expect(flattenContent([{ type: "text", text: "a" }, { type: "refusal", text: "no" }])).toBe("a");
      expect(flattenContent([{ text: "no type field" }])).toBe("no type field");
      expect(flattenContent(undefined)).toBe("");
      expect(flattenContent(null)).toBe("");
    });

    it("reads the Gemini key in Google's documented precedence", () => {
      // Docs: "If both are set, GOOGLE_API_KEY takes precedence."
      expect(geminiKeyFrom({ GOOGLE_API_KEY: "google", GEMINI_API_KEY: "gemini" })).toBe("google");
      expect(geminiKeyFrom({ GEMINI_API_KEY: "gemini" })).toBe("gemini");
      expect(geminiKeyFrom({ GEMINI_API_KEY: "" })).toBe("");
    });
  });

  // ----------------------------------------------------------------- openai

  describe("OpenAILLM", () => {
    it("posts to /chat/completions with the system prompt first, key in a header only", async () => {
      const calls = stubFetch(() => ({ json: openaiReply }));
      const llm = new OpenAILLM(undefined, "sk-test-secret");
      await llm.invoke("chat", "You are Sala.", [{ role: "user", content: "hi" }]);
      expect(calls[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
      expect(calls[0]?.headers.authorization).toBe("Bearer sk-test-secret");
      expect((calls[0]?.body.messages as Record<string, unknown>[])[0]).toEqual({
        role: "system",
        content: "You are Sala.",
      });
      const wire = JSON.stringify(calls[0]?.body) + JSON.stringify(calls[0]?.url);
      expect(wire).not.toContain("sk-test-secret");
    });

    it("honours OPENAI_BASE_URL for a compatible server and trims the slash", async () => {
      const calls = stubFetch(() => ({ json: openaiReply }));
      process.env.OPENAI_BASE_URL = "http://127.0.0.1:11434/v1/";
      await new OpenAILLM(undefined, "local").invoke("chat", "s", [{ role: "user", content: "x" }]);
      expect(calls[0]?.url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    });

    it("chooses the budget field and temperature per model id on the wire", async () => {
      const calls = stubFetch(() => ({ json: openaiReply }));
      process.env.OPENAI_MODEL = DEFAULT_OPENAI_MODEL;
      const llm = new OpenAILLM("http://127.0.0.1:9", "k");
      await llm.invoke("review", "s", [{ role: "user", content: "x" }]);
      expect(calls[0]?.body.max_tokens).toBe(maxTokensFor("review"));
      expect(calls[0]?.body).not.toHaveProperty("max_completion_tokens");
      expect(calls[0]?.body.temperature).toBe(0);

      process.env.OPENAI_MODEL = "gpt-5.4-mini";
      await llm.invoke("review", "s", [{ role: "user", content: "x" }]);
      expect(calls[1]?.body.max_completion_tokens).toBe(maxTokensFor("review"));
      expect(calls[1]?.body).not.toHaveProperty("max_tokens");
      expect(calls[1]?.body).not.toHaveProperty("temperature");
    });

    it("never sends Anthropic-only fields, and never the harness's model id", async () => {
      const calls = stubFetch(() => ({ json: openaiReply }));
      // Exactly the shape of a real dev shell: the harness exports an Anthropic id.
      process.env.ANTHROPIC_MODEL = "qwen3.8-flash";
      process.env.SALA_REVIEW_MODEL = "review-model";
      process.env.SALA_CHAT_MODEL = "persona-model";
      const llm = new OpenAILLM("http://127.0.0.1:9", "k");
      await llm.invoke("review", "s", [{ role: "user", content: "x" }]);
      await llm.invoke("chat", "s", [{ role: "user", content: "x" }]);
      expect(calls[0]?.body.model).toBe("review-model");
      expect(calls[1]?.body.model).toBe("persona-model");
      expect(JSON.stringify(calls.map((c) => c.body))).not.toContain("qwen3.8-flash");
      for (const c of calls) {
        expect(c.body).not.toHaveProperty("thinking");
        expect(c.body).not.toHaveProperty("anthropic_version");
        expect(c.body).not.toHaveProperty("system"); // system rides in messages[] here
      }
    });

    it("parses a parts-array reply as well as a string reply", async () => {
      stubFetch((n) => ({
        json:
          n === 1
            ? { choices: [{ finish_reason: "stop", message: { content: [{ type: "text", text: "parted" }]} }] }
            : openaiReply,
      }));
      const llm = new OpenAILLM("http://127.0.0.1:9", "k");
      expect(await llm.invoke("chat", "s", [{ role: "user", content: "x" }])).toBe("parted");
      expect(await llm.invoke("chat", "s", [{ role: "user", content: "x" }])).toBe("hola");
    });

    it("says out loud when a completion carries no text", async () => {
      stubFetch(() => ({ json: { choices: [{ finish_reason: "length", message: { content: "" } }] } }));
      const llm = new OpenAILLM("http://127.0.0.1:9", "k", "m");
      expect(await llm.invoke("review", "s", [{ role: "user", content: "x" }])).toBe("");
      const line = vi.mocked(console.warn).mock.calls.flat().join(" ");
      expect(line).toContain("phase=review");
      expect(line).toContain("finish_reason=length");
      expect(line).toContain("raise maxTokensFor");
      expect(line).not.toContain("sk-");
    });

    it("reports a rejected request with the model id and the list-models command, not the key", async () => {
      stubFetch(() => ({ status: 400, json: { error: { message: "Invalid model" } } }));
      const llm = new OpenAILLM("http://127.0.0.1:9", "sk-test-secret", "not-a-model");
      await expect(llm.invoke("chat", "s", [{ role: "user", content: "x" }])).rejects.toThrow(
        /not-a-model/,
      );
      const msg = await llm.invoke("chat", "s", [{ role: "user", content: "x" }]).catch((e) => String(e));
      expect(msg).toContain("/models");
      expect(msg).not.toContain("sk-test-secret");
    });

    it("keeps an injected model id above every env override", () => {
      process.env.SALA_MODEL = "from-env";
      process.env.OPENAI_MODEL = "from-provider-env";
      expect(new OpenAILLM("http://127.0.0.1:9", "k", "injected").modelFor("review")).toBe("injected");
    });
  });

  // ----------------------------------------------------------------- gemini

  describe("GeminiLLM", () => {
    it("posts to models/<id>:generateContent with the key in x-goog-api-key only", async () => {
      const calls = stubFetch(() => ({ json: geminiReply }));
      const llm = new GeminiLLM(undefined, "gemini-test-secret");
      await llm.invoke("chat", "You are Sala.", [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "again" },
      ]);
      expect(calls[0]?.url).toBe(
        `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`,
      );
      expect(calls[0]?.headers["x-goog-api-key"]).toBe("gemini-test-secret");
      expect(calls[0]?.url).not.toContain("gemini-test-secret");
      expect(JSON.stringify(calls[0]?.body)).not.toContain("gemini-test-secret");
    });

    it("maps assistant to Gemini's model role and keeps the system instruction separate", async () => {
      const calls = stubFetch(() => ({ json: geminiReply }));
      const llm = new GeminiLLM(undefined, "k");
      await llm.invoke("chat", "persona prompt", [
        { role: "user", content: "u" },
        { role: "assistant", content: "a" },
      ]);
      const contents = calls[0]?.body.contents as { role: string; parts: { text: string }[] }[];
      expect(contents.map((c) => c.role)).toEqual(["user", "model"]);
      expect(contents[1]?.parts[0]?.text).toBe("a");
      expect(calls[0]?.body.systemInstruction).toEqual({ parts: [{ text: "persona prompt" }] });
      expect(calls[0]?.body).not.toHaveProperty("messages");
    });

    it("sends maxOutputTokens and temperature, and no thinking field it cannot verify", async () => {
      const calls = stubFetch(() => ({ json: geminiReply }));
      const llm = new GeminiLLM(undefined, "k");
      await llm.invoke("review", "s", [{ role: "user", content: "x" }]);
      await llm.invoke("chat", "s", [{ role: "user", content: "x" }]);
      expect(calls[0]?.body.generationConfig).toEqual({ maxOutputTokens: 8192, temperature: 0 });
      expect(calls[1]?.body.generationConfig).toEqual({ maxOutputTokens: 2048, temperature: 0.7 });
      const wire = JSON.stringify(calls.map((c) => c.body));
      expect(wire).not.toContain("thinkingConfig");
      expect(wire).not.toContain("thinkingLevel");
      expect(wire).not.toContain("thinkingBudget");
      // No Anthropic id leaks here either.
      process.env.ANTHROPIC_MODEL = "qwen3.8-flash";
      expect(llm.modelFor("chat")).not.toContain("qwen");
    });

    it("joins text parts and drops thought parts", async () => {
      stubFetch((n) => ({
        json:
          n === 1
            ? {
                candidates: [
                  {
                    finishReason: "STOP",
                    content: {
                      parts: [
                        { text: "reasoning that must not leak", thought: true },
                        { text: "{" },
                        { text: '"vocabulary":[]}' },
                      ],
                    },
                  },
                ],
              }
            : geminiReply,
      }));
      const llm = new GeminiLLM(undefined, "k", "m");
      expect(await llm.invoke("review", "s", [{ role: "user", content: "x" }])).toBe('{"vocabulary":[]}');
      expect(vi.mocked(console.warn).mock.calls.length).toBe(0);
    });

    it("warns with the finish reason, and names a safety block", async () => {
      stubFetch((n) =>
        n === 1
          ? { json: { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }] } }
          : { json: { promptFeedback: { blockReason: "SAFETY" }, candidates: [] } },
      );
      const llm = new GeminiLLM(undefined, "k", "m");
      await llm.invoke("review", "s", [{ role: "user", content: "x" }]);
      let line = vi.mocked(console.warn).mock.calls.flat().join(" ");
      expect(line).toContain("finish_reason=MAX_TOKENS");
      expect(line).toContain("raise maxTokensFor");

      await llm.invoke("chat", "s", [{ role: "user", content: "x" }]);
      line = vi.mocked(console.warn).mock.calls.flat().join(" ");
      expect(line).toContain("blocked=SAFETY");
    });

    it("retries a 400 once without temperature rather than degrading quietly", async () => {
      const calls = stubFetch((n) => (n === 1 ? { status: 400, json: {} } : { json: geminiReply }));
      const llm = new GeminiLLM(undefined, "k", "m");
      expect(await llm.invoke("review", "s", [{ role: "user", content: "x" }])).toBe("hola");
      expect(calls.length).toBe(2);
      expect(calls[0]?.body.generationConfig).toEqual({ maxOutputTokens: 8192, temperature: 0 });
      expect(calls[1]?.body.generationConfig).toEqual({ maxOutputTokens: 8192 });
      expect(vi.mocked(console.warn).mock.calls.flat().join(" ")).toContain("without the optional temperature");
    });

    it("does not retry a non-400 failure, and reports the model", async () => {
      const calls = stubFetch(() => ({ status: 403, json: { error: { message: "quota" } } }));
      const llm = new GeminiLLM(undefined, "k", "locked-model");
      await expect(llm.invoke("chat", "s", [{ role: "user", content: "x" }])).rejects.toThrow(
        /HTTP 403 .*locked-model/,
      );
      expect(calls.length).toBe(1);
    });

    it("reads the model from SALA_MODEL above GEMINI_MODEL, per phase", async () => {
      const calls = stubFetch(() => ({ json: geminiReply }));
      process.env.GEMINI_MODEL = "provider-model";
      process.env.SALA_MODEL = "shared-model";
      process.env.SALA_REVIEW_MODEL = "fast-extract-model";
      const llm = new GeminiLLM(undefined, "k");
      await llm.invoke("review", "s", [{ role: "user", content: "x" }]);
      await llm.invoke("chat", "s", [{ role: "user", content: "x" }]);
      expect(calls[0]?.url).toContain("/models/fast-extract-model:generateContent");
      expect(calls[1]?.url).toContain("/models/shared-model:generateContent");
    });
  });
});
