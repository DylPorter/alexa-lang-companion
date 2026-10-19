/**
 * Vitest config — deliberately SEPARATE from vite.config.ts (which has
 * root: "sim" for the web sim and would otherwise hijack the test run).
 * Covers both suites: server tests (node env) + sim tests (jsdom per-file
 * docblock). All offline: EchoLLM / pure functions / component fixtures —
 * LLM conversational quality is the QA checklist's job, not CI's.
 */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/**/*.test.ts", "sim/src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
