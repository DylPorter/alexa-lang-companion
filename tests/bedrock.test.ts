/**
 * Bedrock backend config, offline. Two things bite in a live run and both are
 * cheap to pin here: the default model id must be the geo inference PROFILE
 * (Sonnet 4.5 has no In-Region runtime endpoint, so the bare foundation-model
 * id is not invocable), and the credential-present check that gates the live
 * smoke must accept the Bedrock API key shape as well as the access-key pair.
 * No network, no client construction — BedrockLLM is never invoked in tests.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_BEDROCK_MODEL, BedrockLLM, hasAwsEnvCreds } from "../src/llm/bedrock.js";

const CRED_KEYS = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_BEARER_TOKEN_BEDROCK",
  "BEDROCK_MODEL",
  "AWS_DEFAULT_REGION",
  "AWS_REGION",
] as const;

describe("Bedrock backend config", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of CRED_KEYS) saved[k] = process.env[k];
    for (const k of CRED_KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of CRED_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("defaults to the US cross-region inference profile, not the bare model id", () => {
    expect(DEFAULT_BEDROCK_MODEL).toBe("us.anthropic.claude-sonnet-4-5-20250929-v1:0");
    // The bare id has no In-Region endpoint and is not invocable — never regress to it.
    expect(DEFAULT_BEDROCK_MODEL).not.toBe("anthropic.claude-sonnet-4-5-20250929-v1:0");
  });

  it("reports no creds when the environment is empty", () => {
    expect(hasAwsEnvCreds()).toBe(false);
  });

  it("accepts the access-key pair", () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIDTEST";
    process.env.AWS_SECRET_ACCESS_KEY = "secret";
    expect(hasAwsEnvCreds()).toBe(true);
  });

  it("rejects a half-configured access-key pair", () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIDTEST";
    expect(hasAwsEnvCreds()).toBe(false);
  });

  it("accepts a Bedrock API key on its own (the shape handed to a teammate)", () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "bedrock-key";
    expect(hasAwsEnvCreds()).toBe(true);
  });

  it("reads the model and region from env when set", () => {
    process.env.BEDROCK_MODEL = "global.anthropic.claude-sonnet-4-5-20250929-v1:0";
    process.env.AWS_REGION = "eu-west-1";
    const llm = new BedrockLLM();
    expect(llm.modelId).toBe("global.anthropic.claude-sonnet-4-5-20250929-v1:0");
    expect(llm.region).toBe("eu-west-1");
  });

  it("falls back to the profile default and us-east-1 when env is clear", () => {
    const llm = new BedrockLLM();
    expect(llm.modelId).toBe(DEFAULT_BEDROCK_MODEL);
    expect(llm.region).toBe("us-east-1");
    expect(llm.name).toBe("bedrock");
  });
});
