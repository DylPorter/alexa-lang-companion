/** Inspector formatting tests — pure functions, node environment. */
import { describe, expect, it } from "vitest";
import {
  describeWireEvent,
  formatJson,
  parseWireBody,
  rpcMethodOf,
  toolNameOf,
  WireEvent,
} from "./wireLog";

describe("parseWireBody", () => {
  it("parses plain JSON objects", () => {
    expect(parseWireBody('{"jsonrpc":"2.0","id":1,"method":"ping"}')).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
    });
  });

  it("extracts the first parseable SSE data frame", () => {
    const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{}}\n\n';
    expect(parseWireBody(sse)).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
  });

  it("returns raw text for non-JSON, undefined for empty", () => {
    expect(parseWireBody("oops")).toBe("oops");
    expect(parseWireBody("")).toBeUndefined();
  });

  it("returns raw text for malformed JSON (never throws)", () => {
    expect(parseWireBody('{"broken":')).toBe('{"broken":');
  });
});

describe("rpcMethodOf / toolNameOf", () => {
  it("identifies the JSON-RPC method", () => {
    expect(rpcMethodOf({ jsonrpc: "2.0", id: 1, method: "initialize" })).toBe("initialize");
    expect(rpcMethodOf({ jsonrpc: "2.0", id: 1, result: {} })).toBeUndefined();
    expect(rpcMethodOf("junk")).toBeUndefined();
  });

  it("extracts the tool name only for tools/call", () => {
    expect(toolNameOf({ method: "tools/call", params: { name: "chat" } })).toBe("chat");
    expect(toolNameOf({ method: "tools/list" })).toBeUndefined();
    expect(toolNameOf({ method: "tools/call", params: {} })).toBeUndefined();
  });
});

function ev(partial: Partial<WireEvent> = {}): WireEvent {
  return { id: 1, ts: "2026-10-20T00:00:00.000Z", url: "http://127.0.0.1:3000/mcp", method: "POST", ms: 42, ...partial };
}

describe("describeWireEvent", () => {
  it("labels tools/call with the tool name, status and latency", () => {
    expect(
      describeWireEvent(ev({ request: { method: "tools/call", params: { name: "chat" } }, status: 200 })),
    ).toBe("tools/call · chat → 200 (42 ms)");
  });

  it("falls back to the RPC method, then the HTTP method", () => {
    expect(describeWireEvent(ev({ request: { method: "initialize" }, status: 200 }))).toBe(
      "initialize → 200 (42 ms)",
    );
    expect(describeWireEvent(ev({ status: 200 }))).toBe("POST → 200 (42 ms)");
  });

  it("surfaces fetch errors", () => {
    expect(describeWireEvent(ev({ request: { method: "ping" }, error: "Failed to fetch" }))).toBe(
      "ping → ERR Failed to fetch (42 ms)",
    );
  });
});

describe("formatJson", () => {
  it("pretty-prints objects, passes strings through, dashes undefined", () => {
    expect(formatJson({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(formatJson("raw")).toBe("raw");
    expect(formatJson(undefined)).toBe("—");
  });
});
