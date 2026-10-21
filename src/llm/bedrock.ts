/**
 * BedrockLLM — FIRST-CLASS core backend (SPEC steered 10-20): the submission
 * demo runs on Bedrock (Claude via the converse API) — this is the AWS Builder
 * mini-challenge evidence, not an optional extra.
 *
 * Same LLM protocol shape as firetv-factcheck's backend (author's own in-window
 * code, clean-room reimplementation): model id from BEDROCK_MODEL, region from
 * AWS_DEFAULT_REGION / AWS_REGION / awsRegion.
 *
 * The default is the US cross-region inference PROFILE id, not the bare
 * foundation-model id: Claude Sonnet 4.5 has no In-Region bedrock-runtime
 * endpoint in any region (per the model card's Programmatic Access table,
 * "In-Region endpoint URL: N/A"), so the bare anthropic.claude-sonnet-4-5-*
 * id is not invocable and the geo profile is the supported way to call it.
 * Profiles are passed to Converse as modelId directly. Verified against
 * docs.aws.amazon.com/bedrock/latest/userguide/models-region-compatibility.md
 * on 2026-10-21.
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

/** US geo inference profile for Claude Sonnet 4.5 — see header: the bare
 *  foundation-model id has no In-Region endpoint and is not invocable. */
export const DEFAULT_BEDROCK_MODEL = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

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
          temperature: phase === "review" ? 0 : 0.7,
        },
      }),
    );
    const parts = resp.output?.message?.content ?? [];
    return parts
      .map((b) => ("text" in b ? (b.text ?? "") : ""))
      .join("");
  }
}

/** True when the standard AWS env-credential pair is present (smoke gating). */
export function hasAwsEnvCreds(): boolean {
  return Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}
