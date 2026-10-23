#!/usr/bin/env bash
# Sala one-command demo entry: MCP server + web sim.
# Backend comes from SALA_LLM in the shell, then a SALA_LLM line in the gitignored
# .env, else auto-detection (which is what picks up a teammate's own GEMINI_API_KEY
# or OPENAI_API_KEY). /health prints whichever one won.
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

# Backend resolution, highest precedence first: an explicit shell SALA_LLM, then a
# SALA_LLM line in the gitignored .env, then auto-detection in src/llm/index.ts.
#
# demo.sh must NOT export a default when .env carries the value. dotenv never
# overwrites an existing process.env entry, so `export SALA_LLM=proxy` here silently
# beats `SALA_LLM=bedrock` in .env and the demo records the wrong backend while
# looking exactly like the right one. (Caught 10-21 while wiring Bedrock.)
ENV_LLM=""
if [ -f "$ROOT/.env" ]; then
  # `|| true` is load-bearing: set -e + pipefail would otherwise abort the whole
  # script when .env has no SALA_LLM line (grep exits 1), and a missing line is the
  # normal teammate cold-run, not an error.
  ENV_LLM="$( { grep -E '^[[:space:]]*SALA_LLM=' "$ROOT/.env" || true; } | tail -1 | cut -d= -f2- | tr -d '[:space:]' )"
fi
if [ -n "${SALA_LLM:-}" ]; then
  export SALA_LLM
elif [ -n "$ENV_LLM" ]; then
  : # leave it unset so the server reads it from .env
else
  # Also unset, so src/llm/index.ts auto-detects: AWS creds -> bedrock,
  # ANTHROPIC_BASE_URL -> proxy, a Gemini key -> gemini, an OpenAI key -> openai,
  # else echo. This used to export `proxy` as the fallback, which on a machine that
  # only has a BYOK key means ProxyLLM throws on a missing ANTHROPIC_BASE_URL and
  # the demo comes up dead.
  :
fi
BACKEND="${SALA_LLM:-${ENV_LLM:-auto-detect}}"
# Tell the sim where THIS server lives (matters whenever PORT != 3000, e.g.
# PORT=3100 on a machine where 3000 belongs to another process).
export VITE_MCP_URL="${VITE_MCP_URL:-http://127.0.0.1:${PORT}/mcp}"

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

# Pre-flight: if either port is taken, the server dies on EADDRINUSE while the vite sim
# keeps serving HTTP 200 next to a dead backend — a convincing-but-dead demo, which is
# exactly what a clean-clone test hit on 10-22. Fail before booting anything instead.
for P in "$PORT" "$SIM_PORT"; do
  if ss -ltnH 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${P}$"; then
    echo "demo: port ${P} is already in use by another process." >&2
    echo "      Free it, or run the demo elsewhere, e.g.:" >&2
    echo "        PORT=3100 SIM_PORT=5199 npm run demo" >&2
    exit 1
  fi
done

cat <<EOF

  Sala — demo runbook
  ─────────────────────────────────────────────────────────────
     LLM backend: ${BACKEND} (shell > .env > auto-detect — confirm with the curl below)
     Confirm it before recording:  curl -s http://127.0.0.1:${PORT}/health
  1. Open the sim:      http://localhost:${SIM_PORT}
     (the sim auto-points at this server via VITE_MCP_URL; ad-hoc override
      with ?mcp=http://host:port/mcp)
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

npx concurrently --kill-others -n "$NAMES" -c "$COLORS" "${CMDS[@]}"
