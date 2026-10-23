/**
 * Backend selection (SPEC steered 10-20 — note the order differs from
 * firetv-factcheck: Bedrock is first-class, so AWS creds outrank the proxy):
 *   explicit SALA_LLM=echo|proxy|bedrock|openai|gemini
 *   > AWS creds present → BedrockLLM
 *   > ANTHROPIC_BASE_URL set → ProxyLLM (local dev proxy)
 *   > a Gemini key set → GeminiLLM        ┐ bring-your-own-key lanes, for anyone
 *   > an OpenAI key set → OpenAILLM        ┘ running this without AWS or a gateway
 *   > EchoLLM (deterministic offline fallback).
 * BYOK ranks below the two author-side backends on purpose: they are what the
 * submission evidence runs on, and a stray key in a shared shell must not quietly
 * change which provider a recorded demo used. Anyone on a teammate machine has
 * neither set, so their key wins there — and `SALA_LLM` outranks all of it.
 * Tests always construct EchoLLM explicitly; offline runs never touch a paid backend.
 */
import { LLM } from "./types.js";
import { EchoLLM } from "./echo.js";
import { ProxyLLM } from "./proxy.js";
import { BedrockLLM, hasAwsEnvCreds } from "./bedrock.js";
import { OpenAILLM, hasOpenaiEnvCreds } from "./openai.js";
import { GeminiLLM, hasGeminiEnvCreds } from "./gemini.js";

const FORCED = ["echo", "proxy", "bedrock", "openai", "gemini"] as const;

export function defaultLLM(): LLM {
  const forced = (process.env.SALA_LLM ?? "").trim().toLowerCase();
  if (forced) {
    if (!FORCED.includes(forced as (typeof FORCED)[number])) {
      // A typo here otherwise falls through to auto-detection and lands on Echo,
      // which answers confidently in canned English. On recording day that is a
      // demo with no model behind it, so refuse instead of improvising.
      // The offending value is deliberately NOT echoed: the classic way to hit
      // this branch is pasting a key into the wrong variable, and this repo's rule
      // is names only, never env values (see server/index.ts startup log).
      throw new Error(
        `SALA_LLM is set to something that is not a backend — expected one of ${FORCED.join(", ")}. ` +
          `If you pasted a key here, it belongs in OPENAI_API_KEY or GEMINI_API_KEY instead.`,
      );
    }
    if (forced === "echo") return new EchoLLM();
    if (forced === "proxy") return new ProxyLLM();
    if (forced === "bedrock") return new BedrockLLM();
    if (forced === "openai") return new OpenAILLM();
    return new GeminiLLM();
  }
  if (hasAwsEnvCreds()) return new BedrockLLM();
  if (process.env.ANTHROPIC_BASE_URL) return new ProxyLLM();
  if (hasGeminiEnvCreds()) return new GeminiLLM();
  if (hasOpenaiEnvCreds()) return new OpenAILLM();
  return new EchoLLM();
}

export { EchoLLM, ProxyLLM, BedrockLLM, OpenAILLM, GeminiLLM, hasAwsEnvCreds, hasOpenaiEnvCreds, hasGeminiEnvCreds };
export type { LLM, ChatMessage } from "./types.js";
