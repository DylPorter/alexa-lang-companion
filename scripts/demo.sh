#!/usr/bin/env bash
# Sala one-command demo entry: MCP server (proxy LLM by default) + web sim.
# The server binds loopback only; the sim origin is sanctioned explicitly via
# SALA_ALLOWED_ORIGINS (the strict production default is untouched).
#
# Ports are overridable (dev machines often have 3000/5173 taken):
#   PORT=3100 SIM_PORT=5199 npm run demo
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" || exit 1
cd "$ROOT" || exit 1

PORT="${PORT:-3000}"
SIM_PORT="${SIM_PORT:-5173}"
export PORT
export SALA_ALLOWED_ORIGINS="${SALA_ALLOWED_ORIGINS:-http://localhost:${SIM_PORT}}"
export SALA_LLM="${SALA_LLM:-proxy}"

CMDS=("npm start" "vite --port ${SIM_PORT} --strictPort")
NAMES="server,sim"
COLORS="cyan,magenta"
# Optional local neural TTS for machines whose browser exposes no voices
# (Linux/Chromium). Skipped silently when the piper venv/models are absent —
# the demo then runs on browser voices or text-only, never faked.
if [ -x "$ROOT/.piper-venv/bin/piper" ] && ls "$ROOT"/data/piper-voices/*.onnx >/dev/null 2>&1; then
  CMDS+=("PIPER_ALLOWED_ORIGINS=http://localhost:${SIM_PORT} node scripts/piper-tts-server.mjs")
  NAMES+=",tts"
  COLORS+=",green"
elif [ -n "${REQUIRE_VOICE:-}" ]; then
  echo "demo:voice needs the local Piper TTS fallback (.piper-venv + data/piper-voices/) and it is missing." >&2
  echo "Either install it (see README/qa doc) or run plain 'npm run demo' (browser voices or text-only)." >&2
  exit 1
fi

cat <<EOF

  Sala — demo runbook
  ─────────────────────────────────────────────────────────────
  1. Open the sim:      http://localhost:${SIM_PORT}
     (MCP server:       http://127.0.0.1:${PORT}/mcp · health: /health)
  2. Log an activity ("I went to the gym, tried the climbing wall"),
     then say hi mentioning it — Sala recalls it genuinely (badge).
  3. End session → review panel from what you ACTUALLY said.
     The bottom drawer shows the real MCP JSON-RPC traffic.
  4. Voice: mic button = half-duplex turn (mic re-arms after Sala speaks).
     Quiet room + allow the mic prompt; TTS voice is whatever the browser
     offers (local Piper when the browser has none).
  ─────────────────────────────────────────────────────────────

EOF

npx concurrently -n "$NAMES" -c "$COLORS" "${CMDS[@]}"
