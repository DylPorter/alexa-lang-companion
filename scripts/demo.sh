#!/usr/bin/env bash
# Sala one-command demo entry: MCP server (proxy LLM by default) + web sim.
# The server binds loopback only; the sim origin is sanctioned explicitly via
# SALA_ALLOWED_ORIGINS (the strict production default is untouched).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" || exit 1
cd "$ROOT" || exit 1

export SALA_ALLOWED_ORIGINS="${SALA_ALLOWED_ORIGINS:-http://localhost:5173}"
export SALA_LLM="${SALA_LLM:-proxy}"

cat <<'EOF'

  Sala — demo runbook
  ─────────────────────────────────────────────────────────────
  1. Open the sim:      http://localhost:5173
     (MCP server:       http://127.0.0.1:3000/mcp · health: /health)
  2. Log an activity ("I went to the gym, tried the climbing wall"),
     then say hi mentioning it — Sala recalls it genuinely (badge).
  3. End session → review panel from what you ACTUALLY said.
     The bottom drawer shows the real MCP JSON-RPC traffic.
  ─────────────────────────────────────────────────────────────

EOF

exec npx concurrently -n server,sim -c cyan,magenta "npm start" "vite"
