/**
 * Server-side receipt logging — the terminal half of the "this is a real MCP server" proof.
 *
 * The sim's MCP Tool-Call Inspector shows the wire from the CLIENT side: the JSON-RPC frames
 * the browser sent and got back, with status and latency. This is the far end of the same
 * wire — the server noticing a request landed and saying what it fetched out of SQLite to
 * answer it. Two surfaces, one truth: neither can claim what the other cannot show.
 *
 * Default output is counts only. Learner messages are personal data and a log line is
 * something a developer leaves on screen while filming, so the payload text itself is opt-in
 * with SALA_LOG_CONTEXT=1 — a flag rather than a build change, because the demo beat is
 * "look, it really did go and get that".
 */

/** Verbatim context on the terminal? Read once at import so it cannot flip mid-run. */
export const LOG_CONTEXT = process.env.SALA_LOG_CONTEXT === "1";

/** Long enough to read on camera, short enough that a log stays scannable. */
const PREVIEW_LIMIT = 200;

const preview = (text: string) =>
  text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT - 1)}…` : text;

/** A call arrived. `name` is the JSON-RPC method or tool, not a model's summary of it. */
export function logIncoming(name: string, detail: string): void {
  console.log(`[sala] ← ${name} · ${detail}`);
}

/** The response went out. Status and wall time are the observable facts here. */
export function logDone(name: string, status: number, ms: number): void {
  console.log(`[sala] → ${name} · ${status} · ${ms} ms`);
}

/** What the handler pulled from storage to build this prompt / review. */
export function logFetched(tool: string, parts: Record<string, number | string>): void {
  const counts = Object.entries(parts)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(`[sala] ⛁ ${tool} · from storage: ${counts}`);
}

/** The actual lines handed to the model, when filming asks for them. */
export function logPayload(label: string, lines: string[]): void {
  if (!LOG_CONTEXT || lines.length === 0) return;
  console.log(`[sala] ⛁ ${label} (${lines.length}):`);
  for (const line of lines) console.log(`[sala]     ${preview(line)}`);
}
