/**
 * BedrockLLM — FIRST-CLASS core backend (SPEC steered 10-20): the submission
 * demo runs on Bedrock via the converse API — this is the AWS Builder
 * mini-challenge evidence, not an optional extra.
 *
 * Same LLM protocol shape as firetv-factcheck's backend (author's own in-window
 * code, clean-room reimplementation): model id from BEDROCK_MODEL, region from
 * AWS_DEFAULT_REGION / AWS_REGION / awsRegion.
 *
 * Model choice (steered 10-21 by the author: not Anthropic — signup credits
 * should not burn on a hackathon, and Claude additionally requires a one-time
 * Anthropic use-case form before any invoke). The default is **Amazon Nova
 * Lite**, which is Active and has an In-Region endpoint in us-east-1, so the
 * BARE id is correct here and must NOT carry the `us.` geo-profile prefix that
 * Claude and Llama require. Verified 2026-10-21 against
 * models-region-compatibility.md + the model cards. Rejected alternatives, with
 * receipts: Meta Llama 3.3 70B and 3.1 8B are Legacy ("once the Legacy period
 * begins, new customers can't use Legacy models") and Cohere Command R/R+ are
 * past EOL, so a new account cannot adopt either; Titan Text is absent from the
 * current regional-availability catalog.
 *
 * Nova also rejects `temperature: 0` (documented range 0.00001–1), which is why
 * the review phase goes through temperatureFor() rather than a literal 0.
 *
 * Credentials come from the
 * standard AWS SDK chain (env vars / gitignored .env loaded by src/config.ts /
 * instance profile) and are NEVER logged or printed.
 *
 * Offline tests never construct this class — EchoLLM is the tested surface.
 * Live smoke runs IFF creds exist; otherwise reported as GATED, not failed
 * (AWS enablement is a separate human task).
 */
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { ChatMessage, LLM, maxTokensFor } from "./types.js";

/** Amazon Nova Lite, bare id — In-Region in us-east-1, so no `us.` profile
 *  prefix (that is a Claude/Llama requirement, not a universal one). Active
 *  model, ~$0.06/MTok in and ~$0.24/MTok out: the whole demo workload lands
 *  around US$0.013. Bedrock is the point for the AWS Builder claim, not Claude. */
export const DEFAULT_BEDROCK_MODEL = "amazon.nova-lite-v1:0";

/**
 * Nova rejects temperature 0 (documented range 0.00001–1), so the review
 * phase's deterministic intent has to be expressed as the floor instead of a
 * literal. Anything else keeps 0. Checked on the model id rather than a flag
 * so a future BYOK model does not inherit a silent clamp.
 */
export function temperatureFor(phase: "chat" | "review", modelId: string): number {
  const ideal = phase === "review" ? 0 : 0.7;
  if (ideal > 0) return ideal;
  return modelId.includes("nova") ? 0.00001 : ideal;
}

export class BedrockLLM implements LLM {
  readonly name = "bedrock" as const;
  readonly modelId: string;
  readonly region: string;
  private readonly client: BedrockRuntimeClient;

  constructor(modelId?: string, region?: string) {
    this.modelId = modelId ?? process.env.BEDROCK_MODEL ?? DEFAULT_BEDROCK_MODEL;
    this.region =
      region ?? process.env.AWS_DEFAULT_REGION ?? process.env.AWS_REGION ?? "us-east-1";
    // Credential resolution is delegated to the SDK's default provider chain —
    // this code never touches raw key values.
    this.client = new BedrockRuntimeClient({ region: this.region });
  }

  async invoke(phase: "chat" | "review", system: string, messages: ChatMessage[]): Promise<string> {
    const resp = await this.client.send(
      new ConverseCommand({
        modelId: this.modelId,
        system: [{ text: system }],
        messages: messages.map((m) => ({
          role: m.role,
          content: [{ text: m.content }],
        })),
        inferenceConfig: {
          maxTokens: maxTokensFor(phase),
          temperature: temperatureFor(phase, this.modelId),
        },
      }),
    );
    const parts = resp.output?.message?.content ?? [];
    return parts
      .map((b) => ("text" in b ? (b.text ?? "") : ""))
      .join("");
  }
}

/**
 * True when a Bedrock credential is present in the environment (smoke gating +
 * backend auto-selection). Two accepted shapes:
 *   1. the standard access-key pair, or
 *   2. AWS_BEARER_TOKEN_BEDROCK — a Bedrock API key (console → Bedrock → API
 *      keys). The SDK's default chain picks this up itself: the auth-scheme
 *      preference resolver returns ["httpBearerAuth"] when
 *      `AWS_BEARER_TOKEN_${signingName}` is set and this client's signingName
 *      is "bedrock" (verified in @aws-sdk/core 3.x source, 2026-10-21).
 * Shape 2 is the one to hand a teammate: short-term keys expire by themselves
 * (≤12 h) and Bedrock-scoped by construction, so there is no long-lived key on
 * someone else's machine to remember to revoke.
 */
export function hasAwsEnvCreds(): boolean {
  return Boolean(
    (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ||
      process.env.AWS_BEARER_TOKEN_BEDROCK,
  );
}
