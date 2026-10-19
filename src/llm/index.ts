/**
 * Backend selection (SPEC steered 10-20 — note the order differs from
 * firetv-factcheck: Bedrock is first-class, so AWS creds outrank the proxy):
 *   explicit SALA_LLM=echo|proxy|bedrock
 *   > AWS creds present → BedrockLLM
 *   > ANTHROPIC_BASE_URL set → ProxyLLM (local dev proxy)
 *   > EchoLLM (deterministic offline fallback).
 * Tests always construct EchoLLM explicitly; offline runs never touch Bedrock.
 */
import { LLM } from "./types.js";
import { EchoLLM } from "./echo.js";
import { ProxyLLM } from "./proxy.js";
import { BedrockLLM, hasAwsEnvCreds } from "./bedrock.js";

export function defaultLLM(): LLM {
  const forced = (process.env.SALA_LLM ?? "").trim().toLowerCase();
  if (forced === "echo") return new EchoLLM();
  if (forced === "proxy") return new ProxyLLM();
  if (forced === "bedrock") return new BedrockLLM();
  if (hasAwsEnvCreds()) return new BedrockLLM();
  if (process.env.ANTHROPIC_BASE_URL) return new ProxyLLM();
  return new EchoLLM();
}

export { EchoLLM, ProxyLLM, BedrockLLM, hasAwsEnvCreds };
export type { LLM, ChatMessage } from "./types.js";
