/**
 * Single source of truth for product-facing constants.
 * Renaming the product = changing PRODUCT_NAME here (it is referenced nowhere
 * else as a literal in the UI).
 */
export const PRODUCT_NAME = "Sala";

/** MCP server endpoint. Override with ?mcp=http://host:port/mcp for flexibility. */
export const DEFAULT_MCP_URL = "http://127.0.0.1:3000/mcp";

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
