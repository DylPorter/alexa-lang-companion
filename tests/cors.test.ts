/**
 * CORS tests (A2 web sim browser access, 2026-10-20):
 * An allowlisted origin gets ACAO headers + answered preflights; anything else
 * is refused, and the default (no SALA_ALLOWED_ORIGINS) emits no CORS headers
 * at all — the strict posture A1 shipped with.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { once } from "node:events";
import { createSalaHttpServer } from "../src/server/http.js";
import { MemoryStore } from "../src/memory/db.js";
import { EchoLLM } from "../src/llm/echo.js";

const SIM_ORIGIN = "http://localhost:5173";

interface Raw {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function rawRequest(
  port: number,
  method: string,
  headers: Record<string, string>,
  body?: string,
): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/mcp", method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

let memory: MemoryStore;
let openServer: http.Server; // allowedOrigins: [SIM_ORIGIN]
let strictServer: http.Server; // default — no allowedOrigins
let openPort: number;
let strictPort: number;

async function start(
  opts: Parameters<typeof createSalaHttpServer>[1],
  port = 0,
): Promise<[http.Server, number]> {
  const s = createSalaHttpServer({ memory, llm: new EchoLLM() }, opts);
  s.listen(port, "127.0.0.1");
  await once(s, "listening");
  const addr = s.address();
  if (typeof addr === "string" || addr === null) throw new Error("no address");
  return [s, addr.port];
}

beforeAll(async () => {
  memory = new MemoryStore(":memory:", "cors-test");
  // First pass to learn the ports, then re-create on the SAME ports with
  // literal host allowlists (the allowlist is host:port).
  const [s1, p1] = await start({ allowedOrigins: [SIM_ORIGIN] });
  const [s2, p2] = await start({});
  s1.close();
  s2.close();
  await Promise.all([once(s1, "close"), once(s2, "close")]);
  [openServer, openPort] = await start(
    {
      allowedHosts: [`localhost:${p1}`, `127.0.0.1:${p1}`],
      allowedOrigins: [SIM_ORIGIN],
    },
    p1,
  );
  [strictServer, strictPort] = await start(
    { allowedHosts: [`localhost:${p2}`, `127.0.0.1:${p2}`] },
    p2,
  );
});

afterAll(async () => {
  openServer?.close();
  strictServer?.close();
  memory?.close();
});

describe("CORS with an allowlisted origin", () => {
  it("answers OPTIONS preflight 204 with ACAO echoing the origin", async () => {
    const r = await rawRequest(openPort, "OPTIONS", {
      host: `127.0.0.1:${openPort}`,
      origin: SIM_ORIGIN,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type, mcp-protocol-version",
    });
    expect(r.status).toBe(204);
    expect(r.headers["access-control-allow-origin"]).toBe(SIM_ORIGIN);
    expect(r.headers["access-control-allow-methods"]).toMatch(/POST/);
    expect(r.headers["access-control-allow-headers"]).toMatch(/MCP-Protocol-Version/i);
  });

  it("refuses preflight from a non-allowlisted origin with 403 and no ACAO", async () => {
    const r = await rawRequest(openPort, "OPTIONS", {
      host: `127.0.0.1:${openPort}`,
      origin: "http://evil.example.com",
      "access-control-request-method": "POST",
    });
    expect(r.status).toBe(403);
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("puts ACAO on real POST responses for the allowlisted origin", async () => {
    const r = await rawRequest(
      openPort,
      "POST",
      {
        host: `127.0.0.1:${openPort}`,
        origin: SIM_ORIGIN,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    );
    expect(r.headers["access-control-allow-origin"]).toBe(SIM_ORIGIN);
    expect(r.headers["vary"]).toMatch(/Origin/);
  });

  it("GET /health carries ACAO for the allowlisted origin (sim status check)", async () => {
    const r = await new Promise<Raw>((resolve, reject) => {
      http
        .get(
          { host: "127.0.0.1", port: openPort, path: "/health", headers: { origin: SIM_ORIGIN } },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c) => chunks.push(c as Buffer));
            res.on("end", () =>
              resolve({
                status: res.statusCode ?? 0,
                headers: res.headers,
                body: Buffer.concat(chunks).toString("utf8"),
              }),
            );
          },
        )
        .on("error", reject);
    });
    expect(r.status).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe(SIM_ORIGIN);
    expect(JSON.parse(r.body)).toMatchObject({ ok: true });
  });
});

describe("strict default (no allowedOrigins configured)", () => {
  it("refuses OPTIONS preflight with 403", async () => {
    const r = await rawRequest(strictPort, "OPTIONS", {
      host: `127.0.0.1:${strictPort}`,
      origin: SIM_ORIGIN,
      "access-control-request-method": "POST",
    });
    expect(r.status).toBe(403);
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("emits no ACAO on POST responses even when an Origin is sent", async () => {
    const r = await rawRequest(
      strictPort,
      "POST",
      {
        host: `127.0.0.1:${strictPort}`,
        origin: SIM_ORIGIN,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    );
    // No ACAO → a browser can never READ the response. Note: with an EMPTY
    // allowedOrigins list the SDK skips Origin validation entirely ("no
    // restriction", not "block all") — browser blocking in the strict default
    // comes from the refused preflight above + the missing ACAO here.
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    expect(r.status).toBeLessThan(500);
  });
});
