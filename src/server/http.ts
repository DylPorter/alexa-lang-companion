/**
 * Streamable HTTP host for the Sala MCP server.
 *
 * Stateless mode (sessionIdGenerator: undefined): each POST /mcp gets a fresh
 * McpServer + transport, closed when the response finishes. This fits Sala
 * because ALL durable state lives in SQLite — MCP transport sessions carry
 * nothing we need. A2's sim connects with the SDK's StreamableHTTPClientTransport
 * the same way the integration test does.
 *
 * Security posture (local-first demo):
 *  - The entry point binds loopback by default (SALA_HOST opt-in for wider).
 *  - When `allowedHosts` is provided, requests with any other Host header are
 *    rejected 403 in the handler AND the SDK transport's DNS-rebinding
 *    protection is enabled with the same allowlist (+ allowedOrigins, default
 *    empty = browser cross-origin POSTs blocked; they always send Origin).
 *  - POST bodies must be content-type application/json (415 otherwise), so
 *    cross-origin "simple" form/text POSTs cannot smuggle MCP payloads.
 *  - Body size is capped (413 + destroy) — no unbounded buffering DoS.
 *  - Production identity/auth path (OAuth 2.1 account linking, bearer tokens
 *    via AuthProvider → req.auth) is documented in src/config.ts; the local
 *    demo is a single-user stub.
 */
import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildSalaServer, SalaDeps } from "./tools.js";

export const MCP_PATH = "/mcp";
export const HEALTH_PATH = "/health";
export const MAX_BODY_BYTES = 2 * 1024 * 1024; // generous for MCP JSON-RPC

export interface SalaHttpOptions {
  /** Host-header allowlist; when set, enables 403 enforcement + SDK DNS-rebinding protection. */
  allowedHosts?: string[];
  /** Origin allowlist for the SDK protection (default: [] — cross-origin browser POSTs blocked). */
  allowedOrigins?: string[];
}

async function readJsonBody(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<unknown | undefined> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    bytes += buf.length;
    if (bytes > MAX_BODY_BYTES) {
      res.writeHead(413, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `Request body exceeds ${MAX_BODY_BYTES} bytes` }), () => {
        req.destroy();
      });
      return undefined;
    }
    chunks.push(buf);
  }
  if (res.writableEnded) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length > 0 ? JSON.parse(raw) : undefined;
}

export function createSalaHttpServer(deps: SalaDeps, opts: SalaHttpOptions = {}): http.Server {
  const allowedHosts = opts.allowedHosts ? new Set(opts.allowedHosts) : null;

  return http.createServer(async (req, res) => {
    // Host allowlist (DNS-rebinding defense at the handler level, so it holds
    // even for routes the transport never sees).
    if (allowedHosts && !allowedHosts.has(req.headers.host ?? "")) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden: unexpected Host header" }));
      return;
    }

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
      const contentType = (req.headers["content-type"] ?? "").split(";")[0].trim();
      if (contentType !== "application/json") {
        res.writeHead(415, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Unsupported Media Type: expected application/json" }));
        req.destroy();
        return;
      }

      let body: unknown;
      try {
        body = await readJsonBody(req, res); // 413 already answered if oversized
      } catch {
        if (!res.headersSent) {
          res.writeHead(400).end(JSON.stringify({ error: "Invalid JSON body" }));
        }
        return;
      }
      if (res.writableEnded) return;

      // The transport itself validates message shape (initialize, tool calls,
      // notifications); we don't pre-gate payloads here.
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        ...(allowedHosts
          ? {
              enableDnsRebindingProtection: true,
              allowedHosts: [...allowedHosts],
              allowedOrigins: opts.allowedOrigins ?? [],
            }
          : {}),
      });
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
