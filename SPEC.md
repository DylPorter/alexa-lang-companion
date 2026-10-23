# SPEC — Sala (working name): the living-room language companion

**One-liner (sweep-verified differentiation):** the first Alexa+ add-on that turns your
living-room speaker into a language companion that knows your life — it chats in your
target language about what you actually did today, remembers every conversation, and ends
each session with a grammar and vocabulary review generated from the words you just used.

**Submission:** Amazon "Build, Ship, Shape" (`amazonappdev2026.devpost.com`), **Alexa+ track**,
deadline 23 Oct 2026 12:00 PT. Path: the rule's **self-hosted MCP server**, in our words an **MCP
server hosted anywhere** — the server is plain HTTP, we run it on hardware we pick today and nobody
else's promise stops a real product from running it elsewhere (spec ≥ 2025-11-25 over
**Streamable HTTP**; the pinned SDK 1.32.1 implements 2025-11-25, which is the version Alexa+ for
Builders supports — the newer 2026-07-28 revision is not implemented by any published SDK version,
corrected 10-22 because this line used to claim we targeted it) demonstrated through
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
   tools: chat · log_activity · recall · end_session · list_sessions · set_language
   ├─ Memory store: SQLite (activities, conversations, session summaries, review items)
   │    recall = FTS5 keyword + recency; NO embeddings for v1 (honest simplicity)
   │    portability pitch: the DB file is the user's — production identity via OAuth 2.1
   │    account linking (documented, stubbed for demo as a single-user account id)
   └─ LLM backend: swappable Echo/Proxy/Bedrock/OpenAI/Gemini classes (same shape proven in
        firetv-factcheck/backend/verify_agent.py — Dylan's own in-window code, clean-room OK)
        dev = qwen proxy (ANTHROPIC_BASE_URL); **Bedrock = FIRST-CLASS core backend
        (steered 10-20): Bedrock via converse API, @aws-sdk/client-bedrock-runtime, as the
        AWS Builder mini-challenge evidence, not an optional extra. Model steered 10-21 by Dylan
        to Amazon Nova Lite (bare In-Region id amazon.nova-lite-v1:0) rather than Claude: cost and
        onboarding, and the Bedrock service is the Builder claim, not any one vendor.
        STATUS 10-22, stated honestly because the earlier line read as a promise: the backend is
        implemented, wired as the default selection when credentials exist, and pinned by tests,
        but no live Nova reply has been observed yet. The account is an AWS Organizations member
        whose SCP denies bedrock:CallWithBearerToken (so API keys are unusable), SigV4 authenticates,
        and the Free account plan then returns a first-call "Too many tokens per day". The recorded
        demo therefore runs on the proxy or echo path unless that enablement lands. The AWS Builder
        entry is claimed only if a live Bedrock run is on screen or in the smoke output.**
        BYOK lanes (added 10-23, because Bedrock must not be the only way to run this):
        **OpenAILLM** = any OpenAI-compatible /chat/completions server (OPENAI_API_KEY,
        optional OPENAI_BASE_URL) and **GeminiLLM** = Google v1beta :generateContent
        (GEMINI_API_KEY or GOOGLE_API_KEY, precedence as Google's docs state it). Same LLM
        interface, same /health reporting, same smoke gating. STATUS, same rule as Bedrock:
        implemented and pinned by 28 offline tests that stub fetch, **no live provider reply
        observed yet** — neither author holds such a key here, so the teammate's run is the
        first evidence. Selection:
        explicit SALA_LLM=echo|proxy|bedrock|openai|gemini (an unknown value is a startup
        error, not a silent fall-through to echo), else
        AWS creds present → bedrock, else ANTHROPIC_BASE_URL → proxy, else a Gemini key →
        gemini, else an OpenAI key → openai, else echo
```

## Real-Alexa+ architecture mapping (VERIFIED 10-20 from official docs)

Source: developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview.html —
**"Alexa+ acts as the MCP client. You return standard MCP responses, and Alexa+ handles
natural language understanding, response generation, and user interface (UI) rendering."**
and **"Alexa+ for Builders supports the 2025-11-25 version of the MCP specification."**

Consequences, all three load-bearing:
1. **Audio never reaches a third-party add-on.** The device streams audio to Amazon's cloud
   (wake word → ASR); the MCP server receives text/structured MCP requests; Alexa+ does the
   NLG and the device speaks it. Our text-based MCP server is therefore NOT a workaround —
   it is exactly the real integration surface.
2. **The sim's voice layer faithfully plays the Amazon-side stack.** Browser STT stands in
   for Alexa's cloud ASR, browser TTS for the device speaker. UI/labels must say this
   honestly ("voice layer simulates Alexa+'s device-side ASR/TTS; the server receives text,
   exactly like a real Alexa+ add-on").
3. **Version three-way alignment:** track minimum (2025-11-25) = the version Alexa+ for
   Builders supports = the protocol our pinned SDK (@modelcontextprotocol/sdk 1.32.1)
   implements. State this in the README/description — it's a credibility beat.

Future-work paragraph material (verified same page): the **MCP Apps extension** lets an
add-on render interactive UI in the Alexa+ conversation view via an Amazon-provided webview
("immersive learning experiences" is their example) — that's the production path for Sala's
review cards on real Alexa+. Also noted for A3: Amazon ships a **Local Inspector** for MCP
add-ons and a **Web Simulator** under the Category SDK docs — reference/compare in testing
notes; the hackathon's sanctioned path remains our own web-app simulation.

## Tools (MCP surface)

| tool | in | out | notes |
|---|---|---|---|
| `chat` | `{message, sessionId?, targetLanguage?}` | `{reply, correctionsUsed?, memoryReferenced?, followUps[]}` | core loop: reply in target language, friend persona, gentle inline correction, weaves recalled personal context when relevant; `memoryReferenced` lets the sim UI show a subtle "remembered" indicator — never pretend to recall what isn't stored. On the turn that OPENS a session it also carries `followUps[]`: the pending questions it was handed and is now spending (each `{topic, quote, saidAt, language}`) |
| `log_activity` | `{text, when?}` | `{id}` | user told the companion something they did/are doing; timestamped |
| `recall` | `{query?, since?, limit?}` | `{activities[], pastSessions[], followUps[], focus[]}` | FTS5 + recency; used by `chat` internally and exposed for transparency. `followUps` = the questions still unasked (`topic`, the learner's verbatim quote, when they said it); `focus` = the habits being weighted, with `sessions` counted from stored rows. Both are not filtered by `query` — they are the standing state, and this is the surface a reviewer can use to check the claims |
| `end_session` | `{sessionId}` | `{review: {vocabulary[], grammar[], summary}, followUps[]}` | **the money shot**: review items extracted from what was ACTUALLY said this session — words the user used or struggled with (with the user's own sentence as the example), 1-2 grammar points tied to observed mistakes; stored as a session summary. Also the capture point for cross-session memory: it runs the anticipated-event detector over the learner's own turns and returns what it newly stored, so "Sala will ask you about the interview" is printed from the row it wrote, not from a model's impression |
| `list_sessions` | `{}` | `[{id, date, language, languages[], summary}]` | the "remembers every conversation" proof; sim shows past sessions + their review lists; `languages[]` is every language the session covered, in order |
| `set_language` *(added 2026-10-23)* | `{sessionId, language}` | `{sessionId, previousLanguage, language, languageName, changed}` | changes which language Sala speaks for the rest of a LIVE session without ending it. A capable client (real Alexa+ does the NLU) calls this; `chat` also recognises the request in the learner's own words, so a text-only client still gets it |

### Language switching (added 2026-10-23)

A speaker product where changing language means tapping a setting is not a speaker product. Two
entry points, one persisted truth:

- **`set_language`** — the direct call, for a client that already understood the request.
- **In the words themselves** — `chat` runs `detectLanguageSwitch()` (`src/persona/languages.ts`)
  over the message: find a token that IS a known language name or code, then require a REQUEST
  shape next to it ("let's", "can you", "switch to", "translate", "French please"). A bare mention
  must not hijack the session: "I speak French at work", "what's the word in Spanish?", "how do you
  say thank you in Korean" all leave the language alone, and those are asserted in
  `tests/languages.test.ts` alongside 22 shapes that must switch, in five languages.
- **Words outrank the device's default.** An explicit `targetLanguage` on the same message does NOT
  win: it is a default a client carries into the turn (the sim sends its picker value on the message
  that OPENS a session), not an instruction live in that moment. Detection only fires on a request
  shape, so nothing is lost by letting the learner speak over it — "let's speak Spanish" as someone's
  FIRST words means Spanish, and the session, the transcript tags, the pill and the TTS voice all
  move with it. The reverse order was issue #4: Sala answered in Spanish while every piece of state
  said English, and it was invisible in unit tests because no test sent both.

Consequences that make it one feature rather than a setter: `chat` resolves the language from the
SESSION (not `targetLanguage ?? "en"`, which used to reset an ongoing French session every turn);
each message row records the language it arrived in, so `end_session` can tell the review the
conversation covered two; the sim adopts whatever the server reports instead of wiping the
transcript, and rebinds its TTS/STT locale to it; `justSwitchedFrom` tells the persona to open with
one short clause in the new language, so the handover is audible rather than a silent restart.

Honest limits: identity matching for mistake recurrence is per-language-prefix, so a session that
switched may under-count a repeated mistake (under-claiming, never a fabricated count); and an
unknown code ("nl") is accepted rather than refused — Sala speaks what the model believes that code
means, and the sim falls back to a browser voice.


## Positioning (steered twice 10-20, Dylan): language-agnostic companion, anchored in real learners

The product identity is **language-ambiguous by design**: the companion speaks whatever
`targetLanguage` the learner sets — nothing is hardcoded to English. The anchoring real
users are the team itself: **Alan is ESL (English practice is his baseline need) and is
currently learning German; Dylan is learning French.** That gives the submission authentic
design partners with three live language stories, and the ESL angle still carries the
Impact criterion (English learners = the world's largest language-learning audience) as a
pitch paragraph, not a product constraint. The companion is "a living-room friend who
happens to be a native speaker of whatever you're learning," NOT a classroom tutor.
**Demo language for the video: decided at A2/script time (Alan's lane) — default
recommendation is a language the team genuinely learns, so the demo is real usage.**

## Persona (system-prompt contract, testable via QA checklist)

- A **friend**, not a tutor: warm, curious, asks follow-ups about the user's day; speaks
  the target language at a comprehensible-input level (slightly simplified, never babyish).
  Persona is parameterized by `targetLanguage` + optional learner-L1 hint — no language
  hardcoding in prompts or code.
- Corrections: gentle, inline, max ~1 per exchange, never interrupts flow to lecture.
  Corrected by natural recast (English example: "You went to the gym? Nice — what did you
  do there?") more than explicit rule-dumping; common error classes (articles, tense
  agreement, prepositions, word order) apply across the demo languages.
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

## Demo flow (<3 min, for the video script later) — example scenario in English/ESL (video language is Alan's call; the flow is identical in German/French)

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
  EchoLLM fully offline; unit tests for review extraction over **fixture conversations in two
  languages** (an English ESL transcript with article/tense/preposition mistakes + one
  non-English fixture, e.g. a German or French learner transcript, proving the extraction is
  language-agnostic — review items quote the learner's own sentences in both); Bedrock path
  smokes IFF AWS creds exist in `.env` (else reported as gated, not failed); `npm test` green
  with zero network.
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
- `memoryReferenced` only when a stored fact was genuinely retrieved — and "genuinely retrieved"
  now includes a follow-up row: an opener that asks about a stored event lights the badge, because
  the event came out of the database.
- A follow-up is a stored row or nothing. Only `role=user` turns are scanned (so Sala can never end
  up asking about an event it invented itself), the stored `quote` is the learner's turn verbatim,
  a topic is offered **once ever** (partial unique index on `(account_id, topic) WHERE offered_at IS
  NULL`), and the cue tables exist only for languages whose phrases were checked — an unverified
  language produces no seeds rather than guesses. Any past marker vetoes the whole turn: a false
  veto costs one missed question, a false ask makes Sala claim knowledge of an event that was
  already over. Same asymmetry as `validateLLMReview`, resolved the same way.
- Recurrence counts come from `COUNT(DISTINCT session_id)` over `session_mistakes`, never from a
  model, and the live session cannot count itself (its rows do not exist until `end_session`). The
  2-session gate is a `minSessions` argument, so it is testable rather than vibes. An identity's
  label is the newest stored `point`, falling back to the identity made readable — never an
  invented rule name.
- Emphasis is behaviour, not a claim. The `WORKING ON` block tells the persona to recast the habit
  every time and steer one turn into practice, and tells it twice that the lines are what to
  practise, not what to say: never name a rule, never mention a session count. In the review panel
  the same habit earns the first slot (`prioritiseRecurring`) and one honest sentence in the
  summary with the date it was first logged.
- Wiping memory deletes rows AND rebuilds the FTS indexes, so `recall` cannot answer from content
  that is gone; it is scoped to one `account_id`, and returns per-table counts so the caller can say
  what went rather than "ok".
- Voice turns are committed by the learner, not by a detector. Capture is `continuous: true`; an ASR
  final segment only streams text, and only `stop()` (the mic button) submits a turn. When the
  browser drops the session on its own the transcript is kept and capture relaunches, bounded, and
  past the bound it says so instead of pretending to listen.
- The sim is labeled a simulation everywhere (rules + honesty).
- No secrets in the repo; `.env` gitignored; LLM via env-configurable backend.
- Friction log entries for every tool/API/SDK friction (10% judging bonus material).

## Cross-session continuity (added 2026-10-24, from Dylan's run-through)

Symptom: everything the memory features produced showed up in the **Past sessions** tab and in
`recall`, but the *model* behaved as if a new session were a blank slate. Cause: the only route
into the chat prompt was an FTS match on the current message, plus the two per-turn injections. A
session opened with "hi" retrieved nothing, so the history was real and unread.

Fix: `PersonaConfig.recentSessions` — the newest three ENDED sessions (`summary` + date + language,
all stored rows, current session excluded) rendered as a `CONTINUING FROM` block on **every** turn,
because the prompt is rebuilt per turn and a once-per-session injection quietly stops working after
the first reply. The block is framed as continuity rather than announcement: let it shape what Sala
asks about, never quote a summary line back, never cite a session or its date as a fact about the
learner's life. The MEMORY section now names both memory surfaces (RECALLED CONTEXT = retrieved for
this turn; CONTINUING FROM = standing history), otherwise the older "if no recalled context is
given, do not claim to remember anything" rule contradicts the new block into being ignored.

Integrity consequences, chosen deliberately:
- `memoryReferenced` does NOT light from the standing block. It answers "did Sala look something up
  for what you just said"; a block present on every turn would make the badge constant, and a
  constant badge carries no information. Follow-ups still light it — those are retrieved on the
  opening turn and spent.
- Nothing is invented: the block projects `sessions.summary`, which `end_session` wrote from the
  transcript under the existing verbatim rules.
- `SALA_LOG_CONTEXT=1` prints the exact lines handed to the model on the server terminal
  (`src/server/log.ts`), so "the model was given the history" is checkable without trusting a test
  double. The inspector shows the client half of the same wire; the terminal shows the server half.

## Demo-setup HTTP routes (added 2026-10-23)

`POST /demo/load-history` and `POST /demo/clear-history` on the Sala server back the sim's two
filming buttons. Deliberately **not** MCP tools: a wipe is exactly the kind of destructive action a
voice assistant must never be able to enumerate, and six tools is the surface the submission claims.
Guards: POST only (405), an Origin header must be the sanctioned sim origin (403 — no Origin means a
local process, which already has the file, so the posture is unchanged), and `application/json` is
required so a cross-site form POST cannot reach them without a CORS preflight (415).

Seeding is not a fixture dump. Each scripted session is written as real message rows and closed
through `finishSession()` — the same function `end_session` calls — so the reviews, mistake
identities, recurrence counts and the pending follow-up are produced by the shipping code path,
then back-dated (`daysAgo`/`hourShift`) so the panel reads as a week of history. With no API key it
runs the heuristic extraction path, which means the same four sessions on every take and no spend.

## Non-goals (v1)

Voice I/O in the sim (text chat is sufficient for the sanctioned simulation; TTS is polish if
time remains) · embeddings/vector recall · multi-user auth (documented stub only) · mobile app.
