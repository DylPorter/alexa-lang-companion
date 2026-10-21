/**
 * Bedrock backend config, offline. Three things bite in a live run and all are
 * cheap to pin here: the default model id (Amazon Nova Lite is In-Region in
 * us-east-1, so the bare id is right and a `us.` prefix would be wrong), the
 * credential-present check that gates the live smoke (which must accept the
 * Bedrock API key shape as well as the access-key pair), and Nova's temperature
 * floor (it rejects the literal 0 the review phase wants).
 * No network, no client construction — BedrockLLM is never invoked in tests.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_BEDROCK_MODEL,
  BedrockLLM,
  hasAwsEnvCreds,
  temperatureFor,
} from "../src/llm/bedrock.js";

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

  it("defaults to Amazon Nova Lite on its bare In-Region id", () => {
    expect(DEFAULT_BEDROCK_MODEL).toBe("amazon.nova-lite-v1:0");
    // Nova is In-Region in us-east-1, so the geo-profile prefix (required for
    // Claude and Llama) would be wrong here. And never default to Claude: the
    // author's signup credits should not fund a hackathon, and Anthropic
    // additionally gates every invoke behind a one-time use-case form.
    expect(DEFAULT_BEDROCK_MODEL).not.toMatch(/^(us|global|eu|apac)\./);
    expect(DEFAULT_BEDROCK_MODEL).not.toContain("anthropic");
  });

  it("floors temperature above zero for Nova, which rejects 0", () => {
    expect(temperatureFor("review", DEFAULT_BEDROCK_MODEL)).toBe(0.00001);
    expect(temperatureFor("chat", DEFAULT_BEDROCK_MODEL)).toBe(0.7);
  });

  it("keeps temperature 0 for a model that accepts it (BYOK path)", () => {
    expect(temperatureFor("review", "us.anthropic.claude-sonnet-4-5-20250929-v1:0")).toBe(0);
    expect(temperatureFor("review", "meta.llama3-3-70b-instruct-v1:0")).toBe(0);
    expect(temperatureFor("chat", "amazon.nova-micro-v1:0")).toBe(0.7);
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
