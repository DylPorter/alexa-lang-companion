# A2 QA checklist — persona contract + voice mode

**Date:** 2026-10-20 · **Backend:** qwen proxy (`SALA_LLM=proxy`, ambient `ANTHROPIC_BASE_URL`) ·
**Method:** scripted probe `scripts/a2-persona-qa.ts` over real MCP against an isolated
server (`PORT=3101 SALA_DB_PATH=data/a2-qa.db`), plus manual sim runs at
`docs/a2-assets/`. Conversational quality is deliberately NOT a CI test — this
document is the evidence record.

Transcript snippets below are verbatim probe output / sim bubbles.

## Persona contract (SPEC §Persona)

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | Friend, not tutor: warm, curious, asks follow-ups about the user's day | PASS | P1: USER "Hi Sala! I had a long day at work today." → SALA "Hi! A long day can really wear you out. What made today so tiring?" |
| 2 | Comprehensible input level (slightly simplified, never babyish) | PASS | P1: SALA "In the evenings, I usually make tea and listen to calm music. What do you like to do after work?" — short sentences, natural adult register |
| 3 | Corrections by gentle recast, max ~1 per exchange, never lectures | PASS | P2 turn 1: USER "Yesterday I go to market and I buyed apples." → SALA "You WENT to the market and BOUGHT apples? Nice — what did you buy there?" (one point: past tense, recast inline, flow continues). P2 turn 2: USER "Then I eated lunch with my friend and we was happy." → SALA "You ATE lunch with your friend? That sounds nice — what did you do after?" (leaves "we was" alone — ≤1 correction). Demo EN (a2-03): "Oh, you WENT to the climbing wall and came home super TIRED? … Did you make it to the top of a wall, or did your arms give out halfway?" Demo FR: "Ah, hier tu **es allé** au marché et **tu as acheté** des fraises avec ton ami ?" (one point: passé composé) |
| 4 | No fabricated memories — never asserts what isn't stored | PASS | P3 (nothing about Japan was ever logged): USER "what did I tell you about my trip to Japan last month?" → SALA "I don't have anything about Japan in my memory. Did you go there last month?" |
| 5 | Memory references only when genuinely retrieved (`memoryReferenced` server-side; badge renders off it only) | PASS | P4: activity "Practiced the piano for 40 minutes and learned a new Chopin piece" logged, then USER "I finally sat down at the piano today." → SALA "Nice! Did you play the new Chopin piece?" `[remembered]`. Demo (a2-02): logged "Went to the gym … climbing wall", opener "I just got back from the gym." → "Hey! I remember you tried the climbing wall for the first time today." Badge appears only on turns the server flagged. |
| 6 | Language-agnostic: speaks `targetLanguage`, no hardcoding | PASS | P5 FR: USER "Salut Sala ! Aujourd'hui je suis très content." → SALA "Oh, super ! Qu'est-ce qui te rend si content aujourd'hui ?" Demo FR session (a2-07) fully in French; past sessions store per-session language (a2-05: `fr` + `en`). |
| 7 | Review derived from the actual transcript (learner's own sentences verbatim) | PASS (with caveat) | a2-04 EN: vocab card "I went" ← "Yesterday I go to climbing wall and I am very tire after."; grammar pair said/natural + explanation. a2-07 FR: 6 cards quoting FR sentences verbatim. **Caveat:** FR session's grammar list came back empty (`extractionPath: heuristic`) even though the conversation contained tense mistakes — see Rough edges. |

**Badge-semantics note (P3):** `memoryReferenced` was true on the Japan turn because FTS
surfaced a loosely-related past-session line; the model still refused to invent anything.
The flag means "stored material was genuinely retrieved and offered", not "the reply quotes
it" — consistent with the SPEC contract.

## Voice mode (scope addition 2026-10-20)

Turn-taking: half-duplex, TTS-gated mic (state machine `sim/src/state/voiceMachine.ts`,
unit-tested). Verified live: listening state (a2-08, orb pulse + mic ■), manual stop returns
to idle, mic disabled through thinking+speaking, re-arms after TTS finishes.

| # | Item | Result | Evidence |
|---|------|--------|----------|
| V1 | STT feature-detect + graceful degradation | PASS | Headless Chromium: Web Speech API present, recognition arms (listening state stable >10 s) but yields no transcript without a mic/audio service → on-screen notice "Didn't catch anything — tap the mic again, or just type." (visible in a2-09). Text path never blocked. Browsers without the API get "Voice input isn't available in this browser…" (code path; not live-tested here). |
| V2 | Interim transcript live while listening | PASS (by construction) | `interimResults: true` renders into the conversation pane; headless produced no interim text (silence), so no screenshot of it — see runbook for real-mic expectation. |
| V3 | Full spoken exchange, English | PASS (STT side via labeled test double) | Headless box has no mic input for the SR service, so the final transcript was injected through the exact mic path (`?voicedebug=1` form, labeled "headless QA: STT test double"). Said→heard: injected "Hello Sala! How are you today?" = what the pipeline received (verbatim). Reply spoken by real TTS: "I'm good, thanks! Did you go to the market again today?" (a2-09; speaking state + Piper footer). |
| V4 | Full spoken exchange, French (or German) | PASS (same double) | Injected "Bonjour Sala ! Je suis content de te parler." → spoken FR reply: "Bonjour ! Je suis content de parler avec toi aussi. Tu as acheté des fraises au marché ce matin, elles étaient bonnes ?" (cross-session memory, fr_FR Piper voice). |
| V5 | TTS voice matches target language; honest backend label | PASS | This machine: browser exposes **0** speechSynthesis voices (see TTS verdict) → local Piper (`en_US-lessac-medium`, `fr_FR-siwis-medium`) behind the same `speak()`; footer flips to "voice I/O: local Piper TTS (neural)" at utterance start. On machines with browser voices the footer names the chosen voice. |
| V6 | Voice is an I/O layer, not a different path | PASS | a2-10: the voice turn's `tools/call · chat` JSON-RPC request/response in the inspector — identical shape to text turns; `sessionId`/`memoryReferenced` behave the same. |
| V7 | Honesty labels in voice mode | PASS | "Simulated Alexa+ experience" pill always visible; footer + inspector footnote: "the voice layer simulates Alexa+'s device-side ASR/TTS — the MCP server receives text, exactly like a real Alexa+ add-on" (per SPEC real-Alexa+ mapping). |

### TTS verdict on this machine (Fedora 43, Playwright Chromium headless)

- `window.speechSynthesis` exists but `getVoices()` returns **0 voices**, even after starting
  `speech-dispatcher` (an old broken daemon from Oct 18 had to be killed+restarted; `spd-say`
  then worked) — Chromium's Linux build does not bridge speech-dispatcher voices.
- Fallback used: **local Piper neural TTS** (`scripts/piper-tts-server.mjs`, loopback-only,
  `.piper-venv` + models in gitignored `data/piper-voices/`). Quality: natural neural
  (lessac/siwis medium), real-time on CPU (~1–3 s synthesis per reply). Not Alexa-grade,
  honest label in the UI.
- Recording machine guidance: Chrome/Edge on macOS/Windows expose good system voices and will
  use them automatically (no Piper needed). Piper is the Linux/headless safety net.

### Latency feel (observed, proxy LLM)

- chat turn: 2.8–14 s (qwen proxy; one empty-reply retry observed once, handled server-side)
- Piper synthesis: ~1–3 s per reply; playback gates the mic until `onended`
- `end_session` review: 28–38 s (LLM extraction) — plan the video cut around it

### Demo runbook notes (mic permission + quiet room)

1. On a machine with a real mic: first mic tap triggers the browser permission prompt —
   allow it BEFORE recording; a denied prompt degrades to the notice + text path.
2. Quiet room: Web Speech API streams to the browser's ASR service; background noise causes
   mis-transcripts or `no-speech` ends. Half-duplex design means Sala never talks over the
   user, so echo is not a risk.
3. Rehearse short turns (proxy latency above); the memory beat needs the opener to share a
   keyword with the logged activity ("gym", "marché") — FTS5 is keyword+recency, not semantic.
4. `?voicedebug=1` shows the labeled STT test double — do NOT record it as if it were the mic.
5. Voice language follows the language picker (STT locale en-US/de-DE/fr-FR; Piper voices
   exist for **en+fr+de** — `de_DE-thorsten-medium` downloaded 2026-10-20 (A3) into the
   gitignored `data/piper-voices/`, smoke-tested through the exact sim plumbing
   (`GET /tts?lang=de` → 200, 16-bit mono 22050 Hz WAV ≈3.9 s audio, 1.6 s synthesis).
   German voice mode is complete on this machine; browser STT for de-DE still needs the
   real-mic rehearsal like every locale).

## Rough edges (honest, for A3)

- FR grammar extraction returned zero items on a session with real tense mistakes
  (`extractionPath: heuristic`); EN extraction caught its grammar points. The FR demo beat
  should lean on the in-conversation recast (which works) or A3 should improve FR tables.
- Inspector shows a `GET → 405` line per connect: the SDK client's SSE-listen attempt against
  our stateless transport. Real traffic, harmless; explainable in one narration line.
- Dev-only: Vite HMR fast-refresh preserves the voice state across module swaps while the
  playing `<audio>` is orphaned → machine can stick in `speaking` until a full reload.
  Production (full page loads) is unaffected.
- `end_session` latency (≈30 s) is the demo's dead air; button label says "Generating review…".
