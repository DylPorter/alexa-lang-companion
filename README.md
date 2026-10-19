# Sala (working name) — the living-room language companion

Amazon "Build, Ship, Shape" Developer Hackathon entry (`amazonappdev2026`), **Alexa+ track**. MIT licensed.

An Alexa+ companion MCP server that acts as a living-room friend: it remembers your daily
activities and past conversations, sustains everyday chat in whatever language you're learning
using that personal context, and ends each session with grammar/vocabulary review lists
generated from what you actually said.

**Status: A1 (server core) COMPLETE — 63/63 offline tests green, live proxy smoke passed,
Bedrock smoke GATED on AWS enablement.** Full spec: [SPEC.md](SPEC.md). Demo path: the rules'
sanctioned web-app simulation of the Alexa+ experience — no hardware required.

## What A1 ships

- **MCP server, Streamable HTTP transport** — `@modelcontextprotocol/sdk@1.32.1` (pinned),
  which implements MCP protocol revision **2025-11-25** (`LATEST_PROTOCOL_VERSION`, verified in
  `dist/esm/types.js`). The hackathon requires ≥ 2025-11-25; the newer 2026-07-28 spec revision
  is **not yet implemented by any published SDK version** — recorded honestly, see friction log.
  Stateless HTTP mode: every POST to `/mcp` gets a fresh `McpServer` + transport; all durable
  state lives in SQLite, so nothing depends on MCP session lifetime.
- **The 5 SPEC tools** (`chat`, `log_activity`, `recall`, `end_session`, `list_sessions`) with
  typed zod input AND output schemas — clients get `structuredContent` on every success.
- **SQLite memory (better-sqlite3@13.0.3, SQLite 3.53.4) + FTS5 recall** — keyword match
  (accent-insensitive via `unicode61 remove_diacritics 2`) ranked by bm25 then recency; no
  embeddings. The DB file is the user's: copy/backup/delete it, that's the whole account.
- **Swappable LLM backends** — `EchoLLM` (deterministic, offline test surface), `ProxyLLM`
  (Anthropic-compatible `/v1/messages` via `ANTHROPIC_BASE_URL` — dev loop on the qwen proxy),
  `BedrockLLM` (**first-class**, `@aws-sdk/client-bedrock-runtime@3.1152.0` converse API,
  `BEDROCK_MODEL` default `anthropic.claude-sonnet-4-5-20250929-v1:0`). Selection: explicit
  `SALA_LLM=echo|proxy|bedrock`, else AWS creds → bedrock, else `ANTHROPIC_BASE_URL` → proxy,
  else echo.
- **Language-agnostic persona** (SPEC §Positioning): a friend who happens to be a native
  speaker of whatever you're learning — parameterized by `targetLanguage` + learner-L1 hint,
  comprehensible input, corrections by natural recast (max ~1/exchange), never a fabricated
  memory. Mistake tables for en (ESL: articles/tense/prepositions/word-order/agreement),
  fr, de, minimal es — data, not code.
- **Review extraction with an honesty contract**: the deterministic heuristic path (mistake
  tables + frequency-ranked content words, every example the learner's OWN verbatim sentence)
  is what tests cover; the LLM path (Proxy/Bedrock) enhances, and **every LLM-proposed example
  is validated in code for verbatim containment in the transcript and re-sourced from the
  transcript's own wording** — invented examples are dropped, observed mistakes the model
  missed are backfilled, and any LLM failure falls back to the heuristic.

## Run it

```sh
npm install
npm start                     # MCP server on http://localhost:3000/mcp  (GET /health too)
SALA_LLM=echo npm start       # force deterministic offline backend
npm test                      # 56 tests, zero network (verified in a network namespace)
npm run smoke                 # live proxy smoke (+ bedrock IFF AWS creds; else GATED)
```

Env: `SALA_LLM`, `SALA_DB_PATH` (default `./data/sala.db`, gitignored), `PORT` (3000),
`SALA_TARGET_LANG` / `SALA_NATIVE_LANG` (defaults `en`/`en` — the product is language-agnostic,
defaults are configuration, not identity), `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` for
ProxyLLM, `BEDROCK_MODEL` / `AWS_DEFAULT_REGION` + standard AWS credential chain for Bedrock.
A gitignored `.env` next to the repo root is loaded automatically; secrets are never printed.

## Security posture

Local-first demo, honest about its boundary:

- **Loopback by default** — the server binds `127.0.0.1`; a wider bind is an explicit
  `SALA_HOST=0.0.0.0` opt-in (don't, on untrusted networks: v1 has no request auth).
- **DNS-rebinding / CSRF defense** — Host-header allowlist enforced in the handler (403) and
  in the SDK transport (`enableDnsRebindingProtection` + `allowedHosts`); `allowedOrigins`
  defaults to empty, so browser cross-origin POSTs are blocked. A2 sim: serve same-origin or
  add its origin via `SALA_ALLOWED_ORIGINS=http://localhost:5173`.
- **Content-type enforcement** — POST `/mcp` requires `application/json` (415 otherwise), so
  cross-origin "simple" form/text POSTs can't smuggle MCP payloads.
- **Body cap** — request bodies stream through a 2 MB cap; oversized → 413 + socket destroy
  (no unbounded-buffering DoS).
- **Single-user stub** — constant demo `account_id`; production identity is OAuth 2.1 account
  linking (below). Memory stays self-hosted — portable and private by architecture.

## Identity & portability (SPEC's pitch)

v1 is single-user: every row carries a constant demo `account_id`, and the SQLite file IS the
user's memory — no server-side account, nothing third-party to revoke. **Production path
(documented, not built in v1): Alexa+ account linking via OAuth 2.1.** The MCP server would
publish authorization-server metadata, the Alexa client would obtain a PKCE bearer token, and
`StreamableHTTPServerTransport` surfaces it as `req.auth` (AuthInfo) when an AuthProvider is
configured; `account_id` would then derive from the validated token subject. No schema change
needed — see `src/config.ts`.

## For A2 (web sim)

- Server: `POST /mcp` (Streamable HTTP, **stateless** — connect with the SDK's
  `StreamableHTTPClientTransport`; no session-id juggling), `GET /health` → `{ok, backend}`.
- Tool schemas as built: see `src/server/tools.ts` — every tool declares an `outputSchema`, so
  results arrive in `structuredContent`: `chat` → `{reply, sessionId, memoryReferenced,
  isNewSession}` (pass `sessionId` back on every follow-up turn; `chat` without one starts a
  new Sala session), `log_activity` → `{id}`, `recall` → `{activities[], pastSessions[]}`,
  `end_session` → `{review: {vocabulary[], grammar[], summary}, extractionPath}`,
  `list_sessions` → `{sessions[{id, date, language, summary, review}]}`.
- `memoryReferenced` is true ONLY when stored facts were genuinely retrieved and injected into
  the model prompt (the "remembered" badge must key off this flag, never off reply wording).
- Review items: `vocabulary[].example` and `grammar[].example` are the learner's own sentences
  — display them verbatim on the vocab/grammar cards.
- Demo language is A2/video's call (`targetLanguage` param on `chat`); nothing in A1 presumes it.

## Testing / acceptance map (A1)

- MCP protocol-level integration test (`tests/integration.mcp.test.ts`): real SDK `Client` over
  Streamable HTTP against the real server + EchoLLM + in-memory SQLite — chat → log_activity →
  recall → chat (memoryReferenced beat) → end_session → list_sessions → cross-session recall.
- Review-extraction unit tests over TWO fixture transcripts (`tests/fixtures/conversations.ts`):
  English ESL (tense/article/preposition/word-order/agreement mistakes) + French (auxiliary/
  preposition/idiom/gender) — every asserted example is the fixture learner's own sentence.
- Persona prompt content tests + snapshots; memory/FTS5 unit tests; LLM-path validation tests
  (invented examples dropped, drift re-sourced, observed mistakes backfilled).
- Security tests (`tests/security.test.ts`): foreign Host → 403, non-JSON content-type → 415,
  oversized body → 413/reset, valid requests unaffected.
- Offline proof: `unshare -rn sh -c 'ip link set lo up; npx vitest run'` → 63/63, no external
  interfaces exist in that namespace.

Prior-work note: clean-room build; the LLM-backend-swap and validate-in-code patterns follow
the author's own in-window `firetv-factcheck` backend (same hackathon, same author, separate
submission).
