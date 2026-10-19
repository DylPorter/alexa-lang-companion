/**
 * Security-posture tests for the HTTP layer (review fixes 2026-10-20):
 * Host allowlist → 403, wrong content-type → 415, oversized body → 413.
 * Direct raw HTTP requests against a test-bound server — no MCP client needed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { once } from "node:events";
import { createSalaHttpServer, MAX_BODY_BYTES } from "../src/server/http.js";
import { MemoryStore } from "../src/memory/db.js";
import { EchoLLM } from "../src/llm/echo.js";

let httpServer: http.Server;
let memory: MemoryStore;
let port: number;
const ALLOWED = ["localhost:TESTPORT", "127.0.0.1:TESTPORT"];

beforeAll(async () => {
  memory = new MemoryStore(":memory:", "security-test");
  httpServer = createSalaHttpServer({ memory, llm: new EchoLLM() }, { allowedHosts: ALLOWED });
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const addr = httpServer.address();
  if (typeof addr === "string" || addr === null) throw new Error("no address");
  port = addr.port;
  // re-create with the real port in the allowlist (allowlist is literal host:port)
  httpServer.close();
  await once(httpServer, "close");
  httpServer = createSalaHttpServer(
    { memory, llm: new EchoLLM() },
    { allowedHosts: [`localhost:${port}`, `127.0.0.1:${port}`] },
  );
  httpServer.listen(port, "127.0.0.1");
  await once(httpServer, "listening");
});

afterAll(async () => {
  httpServer?.close();
  await once(httpServer, "close").catch(() => undefined);
  memory?.close();
});

function rawPost(opts: { path?: string; headers?: Record<string, string>; body?: string | Buffer }): Promise<{ status: number; body: string } | { reset: true }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: opts.path ?? "/mcp", method: "POST", headers: opts.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", (err: NodeJS.ErrnoException) => {
      // The server may destroy the socket after answering 413/415 mid-upload;
      // a reset with no response is an acceptable "rejected" outcome.
      if (err.code === "ECONNRESET" || err.code === "EPIPE") resolve({ reset: true });
      else reject(err);
    });
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

describe("Host allowlist (DNS-rebinding defense)", () => {
  it("rejects a foreign Host header with 403", async () => {
    const r = await rawPost({
      headers: { host: "evil.example.com", "content-type": "application/json" },
      body: "{}",
    });
    if ("reset" in r) return; // socket killed before response — still rejected
    expect(r.status).toBe(403);
    expect(r.body).toMatch(/Host/i);
  });

  it("accepts the allowed Host", async () => {
    const r = await rawPost({
      headers: { host: `127.0.0.1:${port}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    if ("reset" in r) throw new Error("allowed host was reset");
    expect(r.status).not.toBe(403);
  });
});

describe("content-type enforcement", () => {
  it("rejects text/plain POSTs with 415 (cross-origin simple-POST smuggling)", async () => {
    const r = await rawPost({
      headers: { host: `127.0.0.1:${port}`, "content-type": "text/plain" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    if ("reset" in r) return;
    expect(r.status).toBe(415);
  });

  it("rejects a missing content-type with 415", async () => {
    const r = await rawPost({
      headers: { host: `127.0.0.1:${port}` },
      body: "{}",
    });
    if ("reset" in r) return;
    expect(r.status).toBe(415);
  });

  it("accepts application/json with charset parameter", async () => {
    const r = await rawPost({
      headers: { host: `127.0.0.1:${port}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    if ("reset" in r) throw new Error("valid content-type was reset");
    expect(r.status).not.toBe(415);
  });
});

describe("body size cap", () => {
  it("answers 413 (or kills the socket) for an oversized body, never buffers it all", async () => {
    const huge = Buffer.alloc(MAX_BODY_BYTES + 1024, 0x61);
    const payload = Buffer.concat([Buffer.from('{"junk":"'), huge, Buffer.from('"}')]);
    const r = await rawPost({
      headers: {
        host: `127.0.0.1:${port}`,
        "content-type": "application/json",
        "content-length": String(payload.length),
      },
      body: payload,
    });
    if ("reset" in r) return; // destroyed mid-upload = the DoS was stopped
    expect(r.status).toBe(413);
  }, 15_000);

  it("normal-size bodies still work end to end", async () => {
    const r = await rawPost({
      headers: { host: `127.0.0.1:${port}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    if ("reset" in r) throw new Error("valid request was reset");
    // tools/list without initialize → JSON-RPC error, but HTTP 200/4xx from the
    // transport means the body pipeline is intact; the SDK client path is covered
    // by integration.mcp.test.ts.
    expect(r.status).toBeLessThan(500);
  });
});
