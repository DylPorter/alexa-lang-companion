/**
 * Vite config for the A2 web sim (sim/ is the app root).
 * Dev server: http://localhost:5173 — the origin sanctioned for CORS via
 * SALA_ALLOWED_ORIGINS in the dev/demo npm scripts. The server itself keeps
 * its strict default (loopback bind, empty origin allowlist) in production.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "sim",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "../dist-sim",
    emptyOutDir: true,
  },
});
