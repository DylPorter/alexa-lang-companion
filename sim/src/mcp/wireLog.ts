/**
 * Wire-level capture + formatting for the MCP tool-call inspector.
 *
 * The tap sits in the transport's custom `fetch`: every JSON-RPC request and
 * response that crosses the wire is recorded verbatim (parsed for display).
 * This is the judges-facing proof that the sim talks REAL MCP — no staging.
 */

export interface WireEvent {
  id: number;
  /** ISO timestamp of request start. */
  ts: string;
  url: string;
  method: string; // HTTP method
  status?: number; // HTTP status
  /** Parsed JSON-RPC request body (or raw text when unparseable). */
  request?: unknown;
  /** Parsed JSON-RPC response body (or first SSE data frame). */
  response?: unknown;
  ms: number;
  error?: string;
}

/** Parse a response body that may be plain JSON or an SSE stream. */
export function parseWireBody(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return text;
    }
  }
  // SSE: collect data: frames, return the first parseable JSON payload.
  if (trimmed.startsWith("event:") || trimmed.startsWith("data:")) {
    for (const line of trimmed.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      try {
        return JSON.parse(payload);
      } catch {
        // keep scanning
      }
    }
    return text;
  }
  return text;
}

/** JSON-RPC method of a captured request, when identifiable. */
export function rpcMethodOf(request: unknown): string | undefined {
  if (request && typeof request === "object" && "method" in request) {
    const m = (request as { method?: unknown }).method;
    if (typeof m === "string") return m;
  }
  return undefined;
}

/** Tool name for tools/call requests. */
export function toolNameOf(request: unknown): string | undefined {
  if (rpcMethodOf(request) !== "tools/call") return undefined;
  const params = (request as { params?: { name?: unknown } }).params;
  return typeof params?.name === "string" ? params.name : undefined;
}

/** One-line human summary for the inspector list row. */
export function describeWireEvent(ev: WireEvent): string {
  const rpc = rpcMethodOf(ev.request);
  const tool = toolNameOf(ev.request);
  const label = tool ? `tools/call · ${tool}` : (rpc ?? ev.method);
  const status = ev.error ? `ERR ${ev.error}` : `${ev.status ?? "?"}`;
  return `${label} → ${status} (${ev.ms} ms)`;
}

/** Pretty JSON for the expanded inspector detail. */
export function formatJson(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
