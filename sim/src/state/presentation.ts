/**
 * Presentation modes, read from the URL like the other runtime affordances
 * (?mcp=, ?tts=, ?voicedebug=1).
 *
 * `?device=1` renders Sala as the living-room product rather than as a dev
 * surface: no admin side column, no activity log row, the presence orb large and
 * top-anchored, the conversation full width, and the generated review inline in
 * the conversation flow — which is also what the README describes as the real
 * production path (an MCP Apps card in the Alexa+ response), so the demo shape
 * and the shipped shape agree.
 *
 * It is NOT a different product. Same MCP client, same server, same tools, same
 * honesty label. The admin panes are one keystroke away for the judges'
 * runtime-evidence beat, and `d` toggles without a reload so the switch can
 * happen live on camera.
 */
export type PresentationMode = "device" | "console";

/** Truthy values accepted for ?device= (bare `?device` counts as on). */
const TRUTHY = new Set(["", "1", "true", "yes", "on"]);

export function modeFromSearch(search: string): PresentationMode {
  const raw = new URLSearchParams(search).get("device");
  if (raw !== null && TRUTHY.has(raw.trim().toLowerCase())) return "device";
  return "console";
}

export function isDeviceMode(search: string = typeof window !== "undefined" ? window.location.search : ""): boolean {
  return modeFromSearch(search) === "device";
}

/**
 * The `d` shortcut must not fire while the presenter is typing. Keypad 'd' and
 * any modified keystroke are ignored too, so browser/IME combos stay intact.
 */
export function isModeToggleKey(
  ev: { key: string; target?: unknown; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean },
): boolean {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return false;
  if (ev.key !== "d" && ev.key !== "D") return false;
  const el = ev.target as { tagName?: string; isContentEditable?: boolean } | undefined;
  const tag = (el?.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return false;
  return true;
}
