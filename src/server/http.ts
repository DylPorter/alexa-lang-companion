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
 *  - CORS (A2 sim): origins on `allowedOrigins` get ACAO headers and answered
 *    OPTIONS preflights (204). The default stays empty — no browser origin can
 *    read responses unless the operator explicitly sanctioned it via
 *    SALA_ALLOWED_ORIGINS. The sim dev script is the sanctioned mechanism.
 *  - POST bodies must be content-type application/json (415 otherwise), so
 *    cross-origin "simple" form/text POSTs cannot smuggle MCP payloads.
 *  - Body size is capped (413 + destroy) — no unbounded buffering DoS.
 *  - `POST /demo/clear-history` and `POST /demo/load-history` erase and rewrite the
 *    stored history. They are not MCP tools (nothing that wipes a user's memory
 *    belongs in a tool list Alexa can see), they refuse a browser Origin that is not
 *    on the sanctioned allowlist, and they require application/json — so a stray page
 *    cannot fire them. They exist because the demo DB is a local file for one person
 *    and filming needs a known starting state.
 *  - Production identity/auth path (OAuth 2.1 account linking, bearer tokens
 *    via AuthProvider → req.auth) is documented in src/config.ts; the local
 *    demo is a single-user stub.
 */
import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildSalaServer, SalaDeps } from "./tools.js";
import { loadSampleHistory, wipeHistory } from "./demo.js";

export const MCP_PATH = "/mcp";
export const HEALTH_PATH = "/health";
/**
 * Demo-history routes (the sim's "Clear history" / "Load prior history" buttons).
 * These are NOT MCP tools: a tool that erases a user's memory would be advertised to
 * Alexa and to every client that lists tools, which is not a thing that should exist.
 * They are local demo setup, so they live on the same loopback server as `/health`
 * and are gated the same way browser access to `/mcp` is.
 */
export const DEMO_CLEAR_PATH = "/demo/clear-history";
export const DEMO_SEED_PATH = "/demo/load-history";
export const MAX_BODY_BYTES = 2 * 1024 * 1024; // generous for MCP JSON-RPC

export interface SalaHttpOptions {
  /** Host-header allowlist; when set, enables 403 enforcement + SDK DNS-rebinding protection. */
  allowedHosts?: string[];
  /**
   * Origin allowlist: feeds the SDK DNS-rebinding protection AND (A2) the CORS
   * headers/preflight answers. Default [] — no browser origin can read responses.
   */
  allowedOrigins?: string[];
}

/** Headers an MCP browser client may send on the real request (preflight ask). */
const CORS_ALLOW_HEADERS = [
  "Content-Type",
  "Accept",
  "Authorization",
  "Last-Event-ID",
  "MCP-Session-Id",
  "MCP-Protocol-Version",
].join(", ");

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
  const allowedOrigins = opts.allowedOrigins ? new Set(opts.allowedOrigins) : null;

  return http.createServer(async (req, res) => {
    // Host allowlist (DNS-rebinding defense at the handler level, so it holds
    // even for routes the transport never sees).
    if (allowedHosts && !allowedHosts.has(req.headers.host ?? "")) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden: unexpected Host header" }));
      return;
    }

    // CORS for allowlisted browser origins (the A2 sim). Default allowlist is
    // empty → no ACAO header is ever emitted and preflights are refused; the
    // strict posture is unchanged unless SALA_ALLOWED_ORIGINS sanctions an origin.
    const origin = req.headers.origin;
    const originAllowed = typeof origin === "string" && (allowedOrigins?.has(origin) ?? false);
    if (originAllowed) {
      res.setHeader("Access-Control-Allow-Origin", origin as string);
      res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS);
      res.setHeader("Access-Control-Expose-Headers", "MCP-Session-Id, MCP-Protocol-Version");
      res.setHeader("Access-Control-Max-Age", "86400");
    }
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      if (originAllowed) {
        res.writeHead(204).end();
      } else {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Forbidden: origin not allowed" }));
      }
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === HEALTH_PATH) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, backend: deps.llm.name }));
      return;
    }

    // ---- demo-history routes (the sim's two setup buttons) --------------------
    if (url.pathname === DEMO_CLEAR_PATH || url.pathname === DEMO_SEED_PATH) {
      const json = (code: number, body: unknown) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.method !== "POST") {
        json(405, { error: "Method not allowed — demo history routes take POST" });
        return;
      }
      // A browser caller must be the sanctioned sim origin — the same allowlist that
      // gates CORS on /mcp, and a JSON content-type forces it to preflight. A caller
      // with no Origin header is a local process, which already has the file: the
      // posture is unchanged, it just cannot be driven from some other page.
      if (typeof origin === "string" && !(allowedOrigins?.has(origin) ?? false)) {
        json(403, { error: "Forbidden: origin not allowed for demo history routes" });
        return;
      }
      const contentType = (req.headers["content-type"] ?? "").split(";")[0].trim();
      if (contentType !== "application/json") {
        res.writeHead(415, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Unsupported Media Type: expected application/json" }));
        req.destroy();
        return;
      }
      try {
        await readJsonBody(req, res); // no inputs; the body is read only to drain the socket
        if (res.writableEnded) return;
        if (url.pathname === DEMO_CLEAR_PATH) {
          json(200, { ok: true, cleared: wipeHistory(deps.memory) });
        } else {
          // Seeding runs the real review pipeline, so it is awaited, not fire-and-forget.
          json(200, { ok: true, ...(await loadSampleHistory(deps.memory)) });
        }
      } catch (err) {
        console.error("[demo] history route failed:", err);
        if (!res.headersSent) {
          json(500, { error: "Demo history operation failed" });
        }
      }
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
