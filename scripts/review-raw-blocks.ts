/**
 * Why does the review phase return empty text? ProxyLLM filters the response to
 * `type === "text"` blocks, so a completion made only of `thinking` looks like an
 * empty reply. This calls the endpoint with the REAL review system prompt and the
 * real fixture, and prints block types + stop_reason + usage instead of filtered
 * text. Run:  npx tsx scripts/review-raw-blocks.ts [maxTokens] [temperature] [extraJson]
 *
 * `extraJson` is merged into the request body, which is how the reasoning-shape
 * probes are run without editing this file each time:
 *   npx tsx scripts/review-raw-blocks.ts 4096 0 '{"thinking":{"type":"disabled"}}'
 *   npx tsx scripts/review-raw-blocks.ts 4096 0 '{"enable_thinking":false}'
 */
import "dotenv/config";
import { reviewSystemPrompt } from "../src/persona/prompts.js";
import { ESL_ENGLISH_FIXTURE } from "../tests/fixtures/conversations.js";

const maxTokens = Number(process.argv[2] ?? 2048);
const temperature = Number(process.argv[3] ?? 0);
const base = (process.env.ANTHROPIC_BASE_URL ?? "").replace(/\/$/, "");
const key = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || "";
const model = process.env.SALA_MODEL || process.env.ANTHROPIC_MODEL || "qwen3.8-flash";
if (!base || !key) throw new Error("ANTHROPIC_BASE_URL / token missing from .env");

const cfg = { targetLanguage: "en", nativeLanguage: "uk" };
const transcript = ESL_ENGLISH_FIXTURE.map((t) => `${t.role === "user" ? "USER" : "SALA"}: ${t.content}`).join("\n");
const system = reviewSystemPrompt(cfg);

const t0 = Date.now();
const resp = await fetch(`${base}/v1/messages`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
    "x-api-key": key,
    authorization: `Bearer ${key}`,
  },
  body: JSON.stringify({
    model,
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [{ role: "user", content: `TRANSCRIPT:\n${transcript}` }],
  }),
  signal: AbortSignal.timeout(180_000),
});
const body = (await resp.json().catch(() => ({}))) as {
  stop_reason?: string;
  usage?: Record<string, unknown>;
  content?: { type?: string; text?: string }[];
  error?: unknown;
};
console.log(
  `HTTP ${resp.status} model=${model} max_tokens=${maxTokens} temp=${temperature} ` +
    `systemChars=${system.length} ${((Date.now() - t0) / 1000).toFixed(1)}s`,
);
console.log(`stop_reason=${body.stop_reason ?? "?"} usage=${JSON.stringify(body.usage ?? {})}`);
console.log(
  `blocks=${JSON.stringify((body.content ?? []).map((b) => `${b.type}:${(b.text ?? "").length}`))}`,
);
if (body.error) console.log(`error=${JSON.stringify(body.error).slice(0, 300)}`);
