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
        dev = qwen proxy (ANTHROPIC_BASE_URL); **Bedrock = FIRST-CLASS core backend
        (steered 10-20): the submission demo runs on Bedrock (Claude via converse API,
        @aws-sdk/client-bedrock-runtime) — it is the AWS Builder mini-challenge evidence,
        not an optional extra.** Selection: explicit SALA_LLM=bedrock|proxy|echo, else
        AWS creds present → bedrock, else ANTHROPIC_BASE_URL → proxy, else echo
```

## Tools (MCP surface)

| tool | in | out | notes |
|---|---|---|---|
| `chat` | `{message, sessionId?, targetLanguage?}` | `{reply, correctionsUsed?, memoryReferenced?}` | core loop: reply in target language, friend persona, gentle inline correction, weaves recalled personal context when relevant; `memoryReferenced` lets the sim UI show a subtle "remembered" indicator — never pretend to recall what isn't stored |
| `log_activity` | `{text, when?}` | `{id}` | user told the companion something they did/are doing; timestamped |
| `recall` | `{query?, since?, limit?}` | `{activities[], pastSessions[]}` | FTS5 + recency; used by `chat` internally and exposed for transparency |
| `end_session` | `{sessionId}` | `{review: {vocabulary[], grammar[], summary}}` | **the money shot**: review items extracted from what was ACTUALLY said this session — words the user used or struggled with (with the user's own sentence as the example), 1-2 grammar points tied to observed mistakes; stored as a session summary |
| `list_sessions` | `{}` | `[{id, date, language, summary}]` | the "remembers every conversation" proof; sim shows past sessions + their review lists |

## Positioning (steered 10-20, Dylan): English companion for ESL learners

The product stays language-agnostic in architecture (`targetLanguage` param), but the
**demo language is English and the demo user persona is an ESL learner** — Alan is ESL
himself, which gives the submission an authentic design partner, a concrete user story for
the description, and the world's largest language-learning audience for the Impact
criterion. The companion is the "living-room friend who happens to be a native English
speaker," NOT a classroom tutor.

## Persona (system-prompt contract, testable via QA checklist)

- A **friend**, not a tutor: warm, curious, asks follow-ups about the user's day; speaks
  natural English at a comprehensible-input level (slightly simplified, never babyish).
- Corrections: gentle, inline, max ~1 per exchange, never interrupts flow to lecture.
  ESL-typical targets: articles (a/the), tense agreement, prepositions, word order —
  corrected by natural recast ("You went to the gym? Nice — what did you do there?") more
  than by explicit rule-dumping.
- Memory use: natural references ("How did that presentation go yesterday?") only when
  genuinely relevant to stored facts. Fabricating memories = integrity violation, same
  rule as the fact-checker: never assert what isn't stored.
- Session close: on `end_session`, the review panel is presented in clear simple English
  (learner L1 configurable in the schema; English-first for the demo — explanations must
  be comprehensible to the learner, examples are the learner's OWN sentences).

## Web sim (demo surface)

Single-page app (agent's choice of stack; keep the build light): living-room companion styling
(say "Sala" + an ambient orb/listening motif), conversation pane in target language, subtle
"remembered" badge when `memoryReferenced` is set, session-end review panel (vocab cards with
the user's own sentences + grammar notes), a collapsible **MCP tool-call inspector** showing
live JSON-RPC (proves the server is real MCP, judges love seeing the seam), and an honest
"simulated Alexa+ experience" label (rules require the video to clearly show the simulation).

## Demo flow (<3 min, for the video script later) — ESL English scenario

1. Evening: user opens the companion → it greets and references a logged activity from
   earlier ("How did the gym session go? You said you'd try the climbing wall") — the memory beat.
2. 3-4 turns of real conversation about the user's day in English → one gentle recast
   correction visible (user: "Yesterday I go to climbing wall." → companion naturally models
   "You WENT to the climbing wall? How did it go?" without breaking the chat).
3. "Let's wrap up for today" → `end_session` → review panel: 4-6 vocabulary items INCLUDING
   words from the actual conversation, plus 1-2 grammar points built from the user's own
   mistakes (their sentence shown, corrected form beside it, one-line explanation).
4. Cut to `list_sessions`: yesterday's session + review still there — state across sessions,
   and yesterday's review item resurfaces naturally in today's chat (spaced-repetition beat
   if it lands cleanly; cut if it doesn't — never staged).
5. Tool-call inspector visible throughout the last beats; "simulated Alexa+ experience" label;
   one line on portable private memory (no third-party Alexa+ memory API exists — the DB is yours).

## Phases + acceptance

- **A1 — server core:** MCP server (Streamable HTTP) with all 5 tools, SQLite memory + FTS5,
  LLM-swap classes (Echo offline / Proxy live / **Bedrock fully implemented**, env-selected),
  system-prompt persona (English ESL companion per Positioning). *Acceptance:* MCP
  protocol-level integration test via an SDK client drives chat→log→recall→end_session against
  EchoLLM fully offline; unit tests for review extraction over an **English ESL fixture
  conversation** (article/tense/preposition mistakes → review items quoting the learner's own
  sentences); Bedrock path smokes IFF AWS creds exist in `.env` (else reported as gated, not
  failed); `npm test` green with zero network.
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
