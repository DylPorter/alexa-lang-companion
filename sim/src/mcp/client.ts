/**
 * SalaClient — the sim talks to the Sala server AS A REAL MCP CLIENT:
 * @modelcontextprotocol/sdk Client over StreamableHTTPClientTransport
 * (Streamable HTTP, stateless server; protocol negotiated via initialize).
 *
 * A custom `fetch` taps every JSON-RPC exchange for the tool-call inspector —
 * the inspector shows the actual wire traffic, verbatim.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { parseWireBody, WireEvent } from "./wireLog";
import type {
  ChatResult,
  EndSessionResult,
  ListSessionsResult,
  LogActivityResult,
  RecallResult,
} from "./types";

export type WireListener = (ev: WireEvent) => void;

let wireSeq = 0;

/** fetch wrapper that records request/response bodies for the inspector. */
export function tappedFetch(onEvent: WireListener): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET");
    const id = ++wireSeq;
    const ts = new Date().toISOString();
    const started = performance.now();
    const requestBody = typeof init?.body === "string" ? init.body : undefined;

    const finish = (
      partial: { status?: number; response?: unknown; error?: string },
    ): void => {
      onEvent({
        id,
        ts,
        url,
        method,
        ms: Math.round(performance.now() - started),
        request: requestBody !== undefined ? parseWireBody(requestBody) : undefined,
        ...partial,
      });
    };

    try {
      const res = await globalThis.fetch(input as RequestInfo, init);
      // Clone so the SDK still consumes the original stream; capture async.
      const capturedStatus = res.status;
      res
        .clone()
        .text()
        .then((text) => finish({ status: capturedStatus, response: parseWireBody(text) }))
        .catch(() => finish({ status: capturedStatus }));
      return res;
    } catch (err) {
      finish({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  };
}

/**
 * Narrow the SDK's callTool union result to Sala's structuredContent contract
 * (schemas live server-side in src/server/tools.ts; the sim renders only these).
 */
function structured<T>(result: unknown, tool: string): T {
  const r = result as { isError?: boolean; content?: unknown; structuredContent?: unknown };
  if (r?.isError) {
    const text = Array.isArray(r.content)
      ? (r.content as Array<{ text?: string }>).map((c) => c.text ?? "").join(" ")
      : "";
    throw new Error(`${tool} failed: ${text || "unknown error"}`);
  }
  if (!r?.structuredContent) throw new Error(`${tool} returned no structuredContent`);
  return r.structuredContent as T;
}

export class SalaClient {
  private client: Client;
  readonly url: string;

  constructor(url: string, onWire: WireListener) {
    this.url = url;
    this.client = new Client({ name: "sala-web-sim", version: "0.1.0" });
    this.transport = new StreamableHTTPClientTransport(new URL(url), {
      fetch: tappedFetch(onWire),
    });
  }

  private transport: StreamableHTTPClientTransport;

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async chat(args: {
    message: string;
    sessionId?: string;
    targetLanguage?: string;
  }): Promise<ChatResult> {
    const res = await this.client.callTool({ name: "chat", arguments: args });
    return structured<ChatResult>(res, "chat");
  }

  async logActivity(args: { text: string; when?: string }): Promise<LogActivityResult> {
    const res = await this.client.callTool({ name: "log_activity", arguments: args });
    return structured<LogActivityResult>(res, "log_activity");
  }

  async recall(args: { query?: string; since?: string; limit?: number } = {}): Promise<RecallResult> {
    const res = await this.client.callTool({ name: "recall", arguments: args });
    return structured<RecallResult>(res, "recall");
  }

  async endSession(args: { sessionId: string }): Promise<EndSessionResult> {
    const res = await this.client.callTool({ name: "end_session", arguments: args });
    return structured<EndSessionResult>(res, "end_session");
  }

  async listSessions(): Promise<ListSessionsResult> {
    const res = await this.client.callTool({ name: "list_sessions", arguments: {} });
    return structured<ListSessionsResult>(res, "list_sessions");
  }
}
