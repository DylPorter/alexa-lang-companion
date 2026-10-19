/**
 * Streamable HTTP host for the Sala MCP server.
 *
 * Stateless mode (sessionIdGenerator: undefined): each POST /mcp gets a fresh
 * McpServer + transport, closed when the response finishes. This fits Sala
 * because ALL durable state lives in SQLite — MCP transport sessions carry
 * nothing we need. A2's sim connects with the SDK's StreamableHTTPClientTransport
 * the same way the integration test does.
 */
import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { buildSalaServer, SalaDeps } from "./tools.js";

export const MCP_PATH = "/mcp";
export const HEALTH_PATH = "/health";

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length > 0 ? JSON.parse(raw) : undefined;
}

export function createSalaHttpServer(deps: SalaDeps): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === HEALTH_PATH) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, backend: deps.llm.name }));
      return;
    }

    if (url.pathname !== MCP_PATH) {
      res.writeHead(404).end(JSON.stringify({ error: "Not found" }));
      return;
    }

    // In stateless mode only POST is meaningful: GET (server→client SSE stream)
    // and DELETE (session teardown) have no session to act on.
    if (req.method === "POST") {
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        res.writeHead(400).end(JSON.stringify({ error: "Invalid JSON body" }));
        return;
      }
      // The transport itself validates message shape (initialize, tool calls,
      // notifications); we don't pre-gate payloads here.
      void isInitializeRequest; // re-exported for consumers/tests that need it
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const server = buildSalaServer(deps);
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
      } catch (err) {
        console.error("[sala] request handling failed:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
        }
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
      return;
    }

    res.writeHead(405, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Method not allowed — Sala runs the Streamable HTTP transport in stateless mode; use POST",
      }),
    );
  });
}

