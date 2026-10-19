# SPEC — Sala (working name): the living-room language companion

**One-liner (sweep-verified differentiation):** the first Alexa+ add-on that turns your
living-room speaker into a language companion that knows your life — it chats in your
target language about what you actually did today, remembers every conversation, and ends
each session with a grammar and vocabulary review generated from the words you just used.

**Submission:** Amazon "Build, Ship, Shape" (`amazonappdev2026.devpost.com`), **Alexa+ track**,
deadline 23 Oct 2026 12:00 PT. Path: **self-hosted MCP server** (spec ≥ 2025-11-25 over
**Streamable HTTP**; we target current 2026-07-28 via the official SDK) demonstrated through
the **sanctioned web-app simulation** ("simulate an Alexa+ experience using your preferred
agentic tools via a web app" — verified from the hackathon resources page; demo video must
clearly show the simulated experience). Zero hardware, zero Amazon payment. The rules'
Creative-bar example is verbatim our category: "context-aware add-on that maintains state
across sessions."

## Architecture

```
[Web sim — the demo surface, styled as an Alexa+ companion UI]
   │  (talks to the server AS AN MCP CLIENT — the repo therefore satisfies the
   │   non-simulated track path too: a real MCP server, imported and called at runtime)
   ▼
[MCP server — TypeScript, @modelcontextprotocol/sdk, Streamable HTTP]
   tools: chat · log_activity · recall · end_session · list_sessions
   ├─ Memory store: SQLite (activities, conversations, session summaries, review items)
   │    recall = FTS5 keyword + recency; NO embeddings for v1 (honest simplicity)
   │    portability pitch: the DB file is the user's — production identity via OAuth 2.1
   │    account linking (documented, stubbed for demo as a single-user account id)
   └─ LLM backend: swappable Echo/Proxy/Bedrock classes (same shape proven in
        firetv-factcheck/backend/verify_agent.py — Dylan's own in-window code, clean-room OK)
        dev = qwen proxy (ANTHROPIC_BASE_URL); Bedrock = optional AWS Builder entry
```

## Tools (MCP surface)

| tool | in | out | notes |
|---|---|---|---|
| `chat` | `{message, sessionId?, targetLanguage?}` | `{reply, correctionsUsed?, memoryReferenced?}` | core loop: reply in target language, friend persona, gentle inline correction, weaves recalled personal context when relevant; `memoryReferenced` lets the sim UI show a subtle "remembered" indicator — never pretend to recall what isn't stored |
| `log_activity` | `{text, when?}` | `{id}` | user told the companion something they did/are doing; timestamped |
| `recall` | `{query?, since?, limit?}` | `{activities[], pastSessions[]}` | FTS5 + recency; used by `chat` internally and exposed for transparency |
| `end_session` | `{sessionId}` | `{review: {vocabulary[], grammar[], summary}}` | **the money shot**: review items extracted from what was ACTUALLY said this session — words the user used or struggled with (with the user's own sentence as the example), 1-2 grammar points tied to observed mistakes; stored as a session summary |
| `list_sessions` | `{}` | `[{id, date, language, summary}]` | the "remembers every conversation" proof; sim shows past sessions + their review lists |

## Persona (system-prompt contract, testable via QA checklist)

- A **friend**, not a tutor: warm, curious, asks follow-ups about the user's day; target language by default (demo language: **Spanish**), comprehensible-input style (slightly simplified, natural).
- Corrections: gentle, inline, max ~1 per exchange, never interrupts flow to lecture.
- Memory use: natural references ("¿Cómo salió la presentación de ayer?") only when genuinely relevant to stored facts. Fabricating memories = integrity violation, same rule as the fact-checker: never assert what isn't stored.
- Session close: on `end_session`, switches to the user's native language for the review panel (review is for learning, not immersion).

## Web sim (demo surface)

Single-page app (agent's choice of stack; keep the build light): living-room companion styling
(say "Sala" + an ambient orb/listening motif), conversation pane in target language, subtle
"remembered" badge when `memoryReferenced` is set, session-end review panel (vocab cards with
the user's own sentences + grammar notes), a collapsible **MCP tool-call inspector** showing
live JSON-RPC (proves the server is real MCP, judges love seeing the seam), and an honest
"simulated Alexa+ experience" label (rules require the video to clearly show the simulation).

## Demo flow (<3 min, for the video script later)

1. Evening: "Sala, háblame en español" → companion greets, references a logged activity from
   earlier ("¿Ya terminaste el proyecto?") — the memory beat.
2. 3-4 turns of real conversation about the user's day → one gentle correction visible.
3. "Terminemos por hoy" → `end_session` → review panel: 4-6 vocab items INCLUDING one the user
   got wrong earlier (their own sentence shown), 1-2 grammar points from observed mistakes.
4. Cut to `list_sessions`: yesterday's session + review still there — state across sessions.
5. Tool-call inspector visible throughout the last beats; "simulated Alexa+ experience" label;
   one line on portable private memory (no third-party Alexa+ memory API exists — the DB is yours).

## Phases + acceptance

- **A1 — server core:** MCP server (Streamable HTTP) with all 5 tools, SQLite memory + FTS5,
  LLM-swap classes (Echo offline / Proxy live), system-prompt persona. *Acceptance:* MCP
  protocol-level integration test via an SDK client drives chat→log→recall→end_session against
  EchoLLM fully offline; unit tests for review extraction over a fixture conversation; `npm test` green.
- **A2 — web sim + demo E2E:** sim UI as an MCP client; full demo flow works against the qwen
  proxy with real Spanish conversation. *Acceptance:* demo flow run manually end-to-end, review
  items demonstrably derived from the actual conversation (screenshot evidence); QA checklist
  for persona (friend-not-tutor, no fabricated memories, correction rate).
- **A3 — submission polish:** README (architecture + rules mapping + clean-room note), demo
  script finalization, Bedrock swap smoke IF enablement exists, friction log throughout, repo
  public + MIT at submission. *Acceptance:* everything in the submission checklist (to be
  written like firetv's `docs/SUBMISSION.md`).

## Honesty rules (carry over from the fact-checker — non-negotiable)

- Review lists derive from the actual conversation transcript, never templates masquerading as extraction.
- `memoryReferenced` only when a stored fact was genuinely retrieved.
- The sim is labeled a simulation everywhere (rules + honesty).
- No secrets in the repo; `.env` gitignored; LLM via env-configurable backend.
- Friction log entries for every tool/API/SDK friction (10% judging bonus material).

## Non-goals (v1)

Voice I/O in the sim (text chat is sufficient for the sanctioned simulation; TTS is polish if
time remains) · embeddings/vector recall · multi-user auth (documented stub only) · mobile app.
