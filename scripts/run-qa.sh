#!/usr/bin/env bash
# One-command live QA replay: drives the scripted persona + money-shot probe in
# scripts/a2-persona-qa.ts against a THROWAWAY server, then prints the verdict
# lines. Exists because conversation quality cannot be a CI test (nondeterministic,
# needs a live backend) but must be re-checkable before a recording session.
#
#   bash scripts/run-qa.sh              # full replay (~2-4 min, makes ~20 LLM calls)
#   SALA_LLM=echo bash scripts/run-qa.sh  # same flow, offline, zero spend
#   SALA_LLM=gemini bash scripts/run-qa.sh # same flow on your own key (BYOK lanes:
#   SALA_LLM=openai bash scripts/run-qa.sh #  gemini | openai — see README, Cold run)
#
# Uses its own port and its own DB so it can never pollute the demo state you are
# about to film with. Reads .env exactly like npm start does.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Must be a real variable, not just a command prefix: `set -u` makes any later
# reference to $SALA_LLM die when it was only ever passed inline to npm start.
# Empty (the default) means "whatever src/llm/index.ts auto-detects", which is what
# lets a teammate run this on his own Gemini/OpenAI key without knowing the flag.
# It used to default to `proxy`, which on a machine with no gateway means ProxyLLM
# throws at startup and run-qa prints "server never became healthy" — a config
# error dressed up as a QA failure.
export SALA_LLM="${SALA_LLM:-}"
QA_PORT="${QA_PORT:-3101}"
QA_DB="${QA_DB:-/tmp/sala-qa.db}"
QA_LOG="${QA_LOG:-/tmp/sala-qa-run.log}"
SERVER_LOG="${SERVER_LOG:-/tmp/sala-qa-server.log}"

# The probe checks cross-session recall and the money shot against a known
# transcript. A leftover DB from a previous run makes those checks vacuous — the
# memories it "recalls" are from the last test, not this one.
rm -f "$QA_DB" "$QA_DB-shm" "$QA_DB-wal"

if ss -ltnH | awk '{print $4}' | grep -qE "[:.]${QA_PORT}$"; then
  echo "run-qa: port ${QA_PORT} is already in use. Set QA_PORT=<other> or free it." >&2
  exit 1
fi

# setsid puts npm + tsx + node in their own process group so cleanup can kill the
# exact tree we started. The PID is read back from a file because setsid forks:
# $! is setsid itself, not the new session leader. Never pkill -f — it matches
# unrelated sessions, including the demo server running for the recording.
PID_FILE="/tmp/sala-qa-${QA_PORT}.pid"
rm -f "$PID_FILE"
cleanup() {
  if [ -f "$PID_FILE" ]; then
    kill -- "-$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
  fi
}
trap cleanup EXIT INT TERM

SALA_DB_PATH="$QA_DB" PORT="$QA_PORT" \
  SALA_ALLOWED_ORIGINS="http://localhost:5199" \
  setsid bash -c "echo \$\$ > '$PID_FILE'; exec npm start" >"$SERVER_LOG" 2>&1 &

for _ in $(seq 1 40); do
  if curl -s -m 2 "http://127.0.0.1:${QA_PORT}/health" | grep -q '"ok":true'; then break; fi
  sleep 0.5
done
BACKEND="$(curl -s -m 3 "http://127.0.0.1:${QA_PORT}/health" || true)"
case "$BACKEND" in
  *'"ok":true'*) echo "run-qa: isolated server up on :${QA_PORT} ${BACKEND}" ;;
  *) echo "run-qa: server never became healthy on :${QA_PORT} — see ${SERVER_LOG}" >&2; exit 1 ;;
esac
# /health names the backend that actually won selection, so compare it with what was
# asked (when anything was asked — an empty SALA_LLM means auto-detect, which is the
# BYOK path). Used to hardcode "proxy", which mis-warned on every other backend.
ACTUAL="$(sed -n 's/.*"backend":"\([^"]*\)".*/\1/p' <<<"$BACKEND")"
if [ -n "$SALA_LLM" ] && [ -n "$ACTUAL" ] && [ "$SALA_LLM" != "echo" ] && [ "$ACTUAL" != "$SALA_LLM" ]; then
  echo "run-qa: WARNING — asked for ${SALA_LLM}, server reports ${BACKEND}" >&2
fi
# Only when echo was NOT the choice: `SALA_LLM=echo bash scripts/run-qa.sh` is the
# documented offline flow, and nagging about it would be noise. Landing on echo by
# auto-detection is the surprise worth a line — it means no key reached the server.
if [ -z "$SALA_LLM" ] && grep -q '"backend":"echo"' <<<"$BACKEND"; then
  echo "run-qa: NOTE — the server is on echo (the offline fallback): this replay exercises no live model." >&2
  echo "         For a real replay: export a key (GEMINI_API_KEY / OPENAI_API_KEY) or set SALA_LLM=proxy|bedrock." >&2
fi

echo "run-qa: replaying the persona + money-shot probe (this makes real LLM calls)..."
npx tsx scripts/a2-persona-qa.ts "http://127.0.0.1:${QA_PORT}/mcp" >"$QA_LOG" 2>&1 && RC=0 || RC=$?

echo
grep -E "^\[P|^===== |extraction=|sessions stored|new-session opener" "$QA_LOG" || true
echo
if [ "$RC" -ne 0 ]; then
  echo "run-qa: probe exited ${RC}. Last server lines:" >&2
  tail -15 "$SERVER_LOG" >&2
  exit "$RC"
fi

# The spoken language switch, replayed on the SAME isolated server (~5 real turns, ~25 s).
# Its verdicts append to $QA_LOG so the `: FAIL` count below gates them too — the switch is
# part of the money shot now (Beat 7b), so it belongs in the pre-flight and not only in CI.
npx tsx scripts/language-switch-proof.ts "http://127.0.0.1:${QA_PORT}/mcp" >>"$QA_LOG" 2>&1 && SW=0 || SW=$?
grep -E '^\[switch\]|^\[past sessions\]' "$QA_LOG" | tail -8 || true
if [ "$SW" -ne 0 ]; then
  echo "run-qa: language-switch proof exited ${SW} — see ${QA_LOG}" >&2
  exit "$SW"
fi

FAILED="$(grep -c ': FAIL\|NO-ITEMS' "$QA_LOG" || true)"
if [ "${FAILED:-0}" -gt 0 ]; then
  echo "run-qa: ${FAILED} verdict(s) failed — see ${QA_LOG}"
  exit 1
fi
echo "run-qa: all verdicts PASS · full transcript: ${QA_LOG}"
# Print WHY any panel degraded, not just that it did. A heuristic fallback is not a
# failure (the review is still honest and verbatim) but it is weaker, and on recording
# day you want to see it in the verdict block instead of digging for it in a log file.
REASONS="$(grep -E '^\[review\]' "$SERVER_LOG" || true)"
if [ -n "$REASONS" ]; then
  echo "run-qa: review-path warnings from the server:"
  sed 's/^/    /' <<<"$REASONS"
else
  echo "run-qa: no review fallbacks — every money shot came back on the LLM path"
fi
# Explicit: a verifier whose exit code depends on whichever echo/pipe happened to run
# last is a verifier that can lie. Pass means 0, nothing else.
exit 0
