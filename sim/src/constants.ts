/**
 * Single source of truth for product-facing constants.
 * Renaming the product = changing PRODUCT_NAME here (it is referenced nowhere
 * else as a literal in the UI).
 */
export const PRODUCT_NAME = "Sala";

/**
 * MCP server endpoint. `scripts/demo.sh` injects VITE_MCP_URL so the sim always
 * points at the server it was started beside (even with a PORT override);
 * ?mcp=http://host:port/mcp still wins for ad-hoc use.
 */
export const DEFAULT_MCP_URL: string =
  (import.meta.env.VITE_MCP_URL as string | undefined) ?? "http://127.0.0.1:3000/mcp";

/** Health endpoint derived from the MCP URL (same origin, /health). */
export function healthUrlFor(mcpUrl: string): string {
  const u = new URL(mcpUrl);
  return `${u.origin}/health`;
}

export function mcpUrlFromLocation(): string {
  if (typeof window === "undefined") return DEFAULT_MCP_URL;
  return new URLSearchParams(window.location.search).get("mcp") ?? DEFAULT_MCP_URL;
}

/** Demo languages (SPEC §Positioning: language-agnostic; picker not config edit). */
export const LANGUAGES = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];

/** Honesty label required by the hackathon rules — always visible. */
export const SIMULATION_LABEL = "Simulated Alexa+ experience";

/**
 * Device-mode status line under the presence orb: what the speaker would be
 * doing right now. Copy stays plain-spoken and never claims Amazon's own ASR/TTS
 * (the SPEC's real-Alexa+ mapping: the MCP boundary receives text, the sim stands
 * in for the device-side voice stack).
 */
export const DEVICE_STATE_COPY: Record<"idle" | "listening" | "thinking" | "speaking", string> = {
  idle: "say hi to start",
  listening: "listening…",
  thinking: "thinking…",
  speaking: "speaking…",
};
