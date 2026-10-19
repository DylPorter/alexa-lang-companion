/**
 * Live smoke — acceptance evidence, NOT part of `npm test` (needs network).
 *
 *   npm run smoke            → proxy smoke (ANTHROPIC_BASE_URL / .env) + Bedrock
 *                              smoke IFF AWS creds exist, else Bedrock = GATED.
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
import type { LLM } from "../src/llm/types.js";

async function smokeBackend(label: string, llm: LLM): Promise<void> {
  const dbPath = join(tmpdir(), `sala-smoke-${label}-${Date.now()}.db`);
  const memory = new MemoryStore(dbPath, "smoke-user");
  const httpServer: http.Server = createSalaHttpServer({ memory, llm });
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const addr = httpServer.address();
  const port = typeof addr === "string" || addr === null ? 0 : addr.port;
  const client = new Client({ name: "sala-smoke", version: "0.1.0" });

  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    await client.callTool({
      name: "log_activity",
      arguments: { text: "tried the new climbing route at the gym this morning" },
    });
    const chat1 = await client.callTool({
      name: "chat",
      arguments: { message: "Hi Sala! Yesterday I go to climbing wall with my friend.", targetLanguage: "en" },
    });
    const s1 = (chat1.structuredContent ?? {}) as Record<string, unknown>;
    const chat2 = await client.callTool({
      name: "chat",
      arguments: { message: "I am so tired today but it was fun.", sessionId: s1.sessionId },
    });
    const end = await client.callTool({ name: "end_session", arguments: { sessionId: s1.sessionId } });

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

async function main(): Promise<void> {
  let ranAny = false;

  if (process.env.ANTHROPIC_BASE_URL) {
    await smokeBackend("proxy", new ProxyLLM());
    ranAny = true;
  } else {
    console.log("=== proxy smoke: SKIPPED (no ANTHROPIC_BASE_URL) ===");
  }

  if (hasAwsEnvCreds()) {
    try {
      await smokeBackend("bedrock", new BedrockLLM());
      ranAny = true;
    } catch (err) {
      console.log(
        "=== bedrock smoke: FAILED —",
        err instanceof Error ? err.message : String(err),
        "===",
      );
      ranAny = true;
    }
  } else {
    // GATED, not failed: AWS enablement is a separate human task.
    console.log("=== bedrock smoke: GATED (no AWS creds in env/.env) ===");
  }

  if (!ranAny) {
    console.error("No live backend available — nothing smoked.");
    process.exit(1);
  }
}

void main();
