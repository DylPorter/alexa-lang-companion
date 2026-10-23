/**
 * Live smoke — acceptance evidence, NOT part of `npm test` (needs network).
 *
 *   npm run smoke            → proxy smoke (ANTHROPIC_BASE_URL / .env) + Bedrock
 *                              smoke IFF AWS creds exist, else Bedrock = GATED,
 *                              + the two bring-your-own-key lanes (gemini, openai)
 *                              IFF their key is present, else SKIPPED.
 *
 * Drives a real MCP client over Streamable HTTP against an in-process server:
 * one ESL chat exchange + one end_session review per available live backend.
 * Prints result SHAPES and content, never env values / keys.
 */
import http from "node:http";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import "../src/config.js"; // loads gitignored .env if present
import { createSalaHttpServer } from "../src/server/http.js";
import { MemoryStore } from "../src/memory/db.js";
import { ProxyLLM } from "../src/llm/proxy.js";
import { BedrockLLM, hasAwsEnvCreds } from "../src/llm/bedrock.js";
import { OpenAILLM, hasOpenaiEnvCreds } from "../src/llm/openai.js";
import { GeminiLLM, hasGeminiEnvCreds } from "../src/llm/gemini.js";
import type { LLM } from "../src/llm/types.js";

/**
 * Pull a useful message out of whatever the backend threw. AWS SDK errors carry
 * `name` and `$metadata.httpStatusCode`, fetch/proxy errors usually only carry
 * `message`, and MCP tool failures arrive as a result object, not an exception.
 * Never prints env values — only error shape and the provider's own text.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const e = err as Error & {
      name?: string;
      statusCode?: number;
      $metadata?: { httpStatusCode?: number };
    };
    const code = e.statusCode ?? e.$metadata?.httpStatusCode;
    return `${e.name ?? err.constructor.name}${code ? ` (${code})` : ""}: ${e.message}`;
  }
  return String(err);
}

/**
 * Direct one-turn call, before the MCP stack exists. A credential or model-access
 * problem has to be reported by the provider, not swallowed by the server's honest
 * fallback reply — which is exactly what happened on 10-21 when a dead Bedrock API
 * key printed `chat#1: {}` and nothing else.
 */
async function preflight(label: string, llm: LLM): Promise<boolean> {
  try {
    const reply = await llm.invoke("chat", "Reply with exactly: OK", [
      { role: "user", content: "Reply with exactly: OK" },
    ]);
    console.log(`=== ${label} preflight: OK (${JSON.stringify(reply.slice(0, 40))}) ===`);
    return true;
  } catch (err) {
    console.log(`=== ${label} preflight: FAILED — ${describeError(err)} ===`);
    return false;
  }
}

async function smokeBackend(label: string, llm: LLM): Promise<void> {
  const dbPath = join(tmpdir(), `sala-smoke-${label}-${Date.now()}.db`);
  const memory = new MemoryStore(dbPath, "smoke-user");
  const httpServer: http.Server = createSalaHttpServer({ memory, llm });
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const addr = httpServer.address();
  const port = typeof addr === "string" || addr === null ? 0 : addr.port;
  const client = new Client({ name: "sala-smoke", version: "0.1.0" });

  // An MCP tool failure is a RESULT with isError set, not an exception, so without
  // this check a broken backend prints a confident-looking pile of undefined.
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    if (res.isError) {
      const blocks = (res.content ?? []) as unknown as { text?: unknown }[];
      const text = blocks
        .map((c) => (typeof c.text === "string" ? c.text : ""))
        .filter(Boolean)
        .join(" ");
      throw new Error(`${name} returned an error: ${text || "<no error text>"}`);
    }
    return res;
  };

  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    await call("log_activity", {
      text: "tried the new climbing route at the gym this morning",
    });
    const chat1 = await call("chat", {
      message: "Hi Sala! Yesterday I go to climbing wall with my friend.",
      targetLanguage: "en",
    });
    const s1 = (chat1.structuredContent ?? {}) as Record<string, unknown>;
    const chat2 = await call("chat", {
      message: "I am so tired today but it was fun.",
      sessionId: s1.sessionId,
    });
    const end = await call("end_session", { sessionId: s1.sessionId });

    console.log(`\n=== ${label} smoke ===`);
    console.log("chat#1:", JSON.stringify({
      reply: s1.reply,
      memoryReferenced: s1.memoryReferenced,
      isNewSession: s1.isNewSession,
    }, null, 2));
    console.log("chat#2:", JSON.stringify((chat2.structuredContent as Record<string, unknown>)?.reply));
    const endSc = (end.structuredContent ?? {}) as Record<string, unknown>;
    console.log("end_session extractionPath:", endSc.extractionPath);
    console.log("review:", JSON.stringify(endSc.review, null, 2));
  } finally {
    await client.close().catch(() => undefined);
    httpServer.close();
    await once(httpServer, "close").catch(() => undefined);
    memory.close();
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }
}

/** Preflight then full MCP round-trip for one backend, never throwing. */
async function runBackend(label: string, llm: LLM): Promise<boolean> {
  if (!(await preflight(label, llm))) return false;
  try {
    await smokeBackend(label, llm);
    return true;
  } catch (err) {
    console.log(`=== ${label} smoke: FAILED — ${describeError(err)} ===`);
    return false;
  }
}

async function main(): Promise<void> {
  let ranAny = false;
  const failed: string[] = [];

  if (process.env.ANTHROPIC_BASE_URL) {
    if (!(await runBackend("proxy", new ProxyLLM()))) failed.push("proxy");
    ranAny = true;
  } else {
    console.log("=== proxy smoke: SKIPPED (no ANTHROPIC_BASE_URL) ===");
  }

  if (hasAwsEnvCreds()) {
    // Report which credential shape resolved, never the value.
    const probe = new BedrockLLM();
    const bearer = Boolean(process.env.AWS_BEARER_TOKEN_BEDROCK);
    const keyPair = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
    console.log(
      `=== bedrock creds: ${bearer ? "API key (bearer)" : keyPair ? "access-key pair (SigV4)" : "?"} · model ${probe.modelId} · region ${probe.region} ===`,
    );
    if (bearer && keyPair) {
      // The SDK's auth-scheme preference resolver picks bearer whenever
      // AWS_BEARER_TOKEN_BEDROCK is set, so a leftover line silently outranks the
      // access keys. Comment it out rather than being surprised by a bearer-only
      // SCP deny that has nothing to do with the keys you just made.
      console.log(
        "!!! both credential shapes are set — bearer WINS. Comment out the unused one.",
      );
    }
    ranAny = true;
    if (!(await runBackend("bedrock", new BedrockLLM()))) failed.push("bedrock");
  } else {
    // GATED, not failed: AWS enablement is a separate human task.
    console.log("=== bedrock smoke: GATED (no AWS creds in env/.env) ===");
  }

  // The two bring-your-own-key lanes. These are the only backends a teammate can
  // run without AWS or Dylan's gateway, and the offline suite only stubs fetch —
  // so a green `npm test` says nothing about whether the real provider accepts the
  // request. Whatever the provider answers here is the evidence, and a key that is
  // absent is SKIPPED (nothing to verify), not passed.
  if (hasGeminiEnvCreds()) {
    const probe = new GeminiLLM();
    console.log(
      `=== gemini creds: ${process.env.GOOGLE_API_KEY ? "GOOGLE_API_KEY" : "GEMINI_API_KEY"} · model ${probe.modelFor("chat")} ===`,
    );
    ranAny = true;
    if (!(await runBackend("gemini", probe))) failed.push("gemini");
  } else {
    console.log("=== gemini smoke: SKIPPED (no GEMINI_API_KEY / GOOGLE_API_KEY) ===");
  }

  if (hasOpenaiEnvCreds()) {
    const probe = new OpenAILLM();
    console.log(
      `=== openai creds: OPENAI_API_KEY · base ${probe.baseUrl} · model ${probe.modelFor("chat")} ===`,
    );
    ranAny = true;
    if (!(await runBackend("openai", probe))) failed.push("openai");
  } else {
    console.log("=== openai smoke: SKIPPED (no OPENAI_API_KEY) ===");
  }

  if (!ranAny) {
    console.error("No live backend available — nothing smoked.");
    process.exit(1);
  }
  // A backend that was attempted and failed must not exit 0: `npm run smoke` is
  // acceptance evidence, and evidence that passes on a dead key is worse than none.
  if (failed.length > 0) {
    console.error(`\nSmoke FAILED for: ${failed.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("\nSmoke OK for every backend that was attempted.");
  }
}

void main();
