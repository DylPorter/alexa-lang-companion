/**
 * The two demo-setup buttons talk to plain HTTP routes on the same server, NOT to
 * MCP tools — see `src/server/http.ts`: nothing that erases a learner's memory should
 * be advertised in a tool list a voice assistant can enumerate. The sim is the only
 * UI, so the calls live here, next to the MCP client, and are derived from the same
 * `?mcp=` URL the picker already honours (so a server on an overridden port still
 * works, exactly like `healthUrlFor`).
 */
import type { FollowUp, FocusHabit } from "./types";

export type DemoRoute = "clear" | "seed";

const PATHS: Record<DemoRoute, string> = {
  clear: "/demo/clear-history",
  seed: "/demo/load-history",
};

export interface DemoOutcome {
  ok: true;
  /** Only the clear route answers this. */
  cleared?: Record<string, number>;
  /** Only the seed route answers these. */
  sessions?: number;
  messages?: number;
  activities?: number;
  followUps?: FollowUp[];
  focus?: FocusHabit[];
}

export function demoUrlFor(mcpUrl: string, route: DemoRoute): string {
  const { origin } = new URL(mcpUrl);
  return `${origin}${PATHS[route]}`;
}

/**
 * POST an empty JSON body. `application/json` is not a CORS-simple content type, so a
 * browser preflights it and the server's origin allowlist gets to decide — that is the
 * whole gate, and it is why this sends a body at all.
 */
export async function runDemoRoute(
  mcpUrl: string,
  route: DemoRoute,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<DemoOutcome> {
  const url = demoUrlFor(mcpUrl, route);
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const text = await res.text();
  if (!res.ok) {
    // Surface the server's own reason (it answers 403/405/415/500 with a JSON `error`),
    // so a refusal is legible instead of a silent no-op button.
    const reason = (safeParse(text) as { error?: string } | null)?.error ?? `${res.status} ${res.statusText}`;
    throw new Error(`${route === "clear" ? "Clear" : "Load"} failed: ${reason}`);
  }
  const parsed = safeParse(text);
  if (!parsed || typeof parsed !== "object") throw new Error(`${route} returned a non-JSON body`);
  return parsed as DemoOutcome;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
