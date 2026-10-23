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
- ~~`end_session` latency (≈30 s) is the demo's dead air~~ **fixed 2026-10-23**: reasoning off the
  extraction pass took it to 5-10 s (median 6.3-6.6 s over eleven samples; `docs/LATENCY.md`). Chat
  turns are the slow half now at median ~5.7 s, which is comfortable inside a take.

## 2026-10-23 — fast path re-run, and mistake recurrence proven on real sessions

`bash scripts/run-qa.sh` with `SALA_CHAT_THINKING=off` (isolated server on :3101, throwaway DB,
`{"ok":true,"backend":"proxy"}`): **every verdict PASS, zero heuristic fallbacks.**

```
===== P6 French review (money shot, FR) — extraction=llm  9.9s =====  [P6-FR] verbatim: PASS (5/5)
===== P7 ESL review  (money shot, EN) — extraction=llm  5.6s =====    [P7-EN] verbatim: PASS (5/5)
===== P8 German review (money shot, DE) — extraction=llm 7.3s =====   [P8-DE] verbatim: PASS (7/7)
[P9] stored-reviews: PASS · sessions stored: 7, with a stored review: 3
```

P1-P5 are read, not asserted. With reasoning off on the persona pass they still held the contract —
`"You WENT to the market and BOUGHT apples? Nice!"` (one exchange, corrections as recasts, not a
lecture), `"You actually didn't tell me about a trip to Japan."` on the un-logged trip (P3, no
fabricated memory), `"vous êtes allés au cinéma ?"` in French (P5). The measured price is reply length,
not correctness: 49-80 characters with thinking off against 100-148 with it on, which is why the knob
is not the shipped default (`docs/LATENCY.md`).

### Recurrence (issue #2) — three real closed sessions against the live server

`npx tsx scripts/recurrence-proof.ts http://127.0.0.1:3100/mcp 3` — the same learner habit in three
separate sessions, each closed with `end_session`, nothing mocked:

```
session 1 (f513ed4c) · end_session 6.5s · path=llm
  · Past Simple Tense   id=en-past-simple-tense   recurrence: none
session 2 (f8e9216d) · end_session 5.5s · path=llm
  · Past Simple Tense   id=en-past-simple-tense   recurrence: seen 2× since 2026-10-23
  summary: … They mentioned finishing exercises slowly, being tired, and ignoring their trainer's
           advice to rest. 1 of these is a mistake you've made before, first logged on 2026-10-23.
session 3 (36224e68) · end_session 5.1s · path=llm
  · Past Simple Tense   id=en-past-simple-tense   recurrence: seen 3× since 2026-10-23

[recurrence] seenInSessions per session: 0 → 2 → 3
[recurrence] first session asserts nothing: PASS
[recurrence] a repeat earned a count: PASS (3×)
```

Session 1 claims **nothing** — no `recurrence` field, no summary sentence — because no row existed
before it. That absence is the guard: the count comes from `COUNT(DISTINCT session_id)` over stored
rows read *before* the current session's rows are written, so it cannot drift into a flattering
"you always get this wrong".

**Honest limit, and it is the interesting one.** On the LLM path the identity is the folded label
(`"Past Simple Tense"` → `en-past-simple-tense`), so a repeat is only counted when the model words the
class the same way twice (`temperature: 0` helps, `MISTAKE_ALIASES` maps the variants we have actually
seen onto the heuristic table's ids). Two differently-worded labels for one mistake class stay two
identities and the chip stays silent. The failure mode is under-claiming, never a number with no row
behind it — for filming, close the sessions in the same language with the same error and the count
goes up on camera.

### The same thing seen through the browser, not the terminal

`?device=1` (the filming view) driven with the keyboard only: one typed turn ("Yesterday I go to the
park and I see three dog."), End session, panel rendered. Read off the live DOM, not the source:

- chip text exactly `recurring · seen 4×`, title `first seen 2026-10-23`, on the Past Simple Tense card
- summary ends `1 of these is a mistake you've made before, first logged on 2026-10-23.`
- panel line `path: llm`, "Simulated Alexa+ experience" label still on screen in device mode
- no overflow, no clipping, no overlap: chip box 125×18 px inside a 360×208 card, `scrollWidth ==
  clientWidth`, single line, no other text node intersecting it
- **the chip's contrast did NOT clear AA, and the first reading of it was wrong.** The numbers written
  into this file an hour earlier (5.09:1, body text 11.40:1) were never measured by anything — they were
  recorded before the browser report landed, and the real figures are these: amber `#e8a44c` text on the
  amber-soft plate measures **3.89:1** against the pill background read from the rendered pixels and
  **5.27:1** against the plate composited from CSS (`rgba(232,164,76,.16)` over `--panel-2 #2a241d` =
  `rgb(72,56,37)`). 10.5px text needs 4.5:1. Both readings disagree because the plate is translucent, so
  the fix had to be safe under each: the new recurrence elements now draw text in `--amber-on-soft
  #f5c987`, which measures **5.36:1** on the pixel reading and **7.27:1** on the composited one. That is
  the honest reason for the lighter amber, not taste.
- **Pre-existing, not fixed today:** `.sim-label`, `.remembered-badge`, `.lang-active` and `.session-lang`
  all use the same amber-on-amber-soft combination and sit at the same 3.89-5.27:1 spread. Left alone on
  filming eve because changing the accent tokens touches every pill in the app; worth lifting to
  `--amber-on-soft` after the submission if anyone squints at them on a TV.
- **Past sessions is NOT in the filming view.** `?device=1` renders no tabs at all (zero `.tab` /
  `[role=tab]` elements — the admin column isn't mounted in device mode). Beat 7 therefore has to be
  shot either by toggling out of device view with `d`, or from the plain page, and the runbook says so.
  From the non-device view all 4 closed EN sessions list with their stored reviews, and expanding the
  13:22 card shows the chip **persisted from the DB**, not just from the live render.
- console: **one benign error**, `Failed to load resource: 405 (Method Not Allowed) @ /mcp` — the SDK
  client's GET SSE-listen probe against our stateless POST-only transport (friction log 2026-10-20).
  No schema or MCP validation errors; `initialize → 200`, `notifications/initialized → 202`,
  `list_sessions → 200` all healthy beside it.
- Sala's reply to the typed turn took ~20 s wall clock in the browser, longer than the 5.7 s the chat
  probe measures. That gap is browser STT/TTS + the sim's turn-taking, not the LLM: relevant to how much
  air the voice beats leave, not to the review panel.
- captures: `docs/a3-assets/a3-01-initial-device-view.png`, `a3-02-review-panel.png`,
  `a3-03-past-session-expanded.png`, `a3-04-past-simple-card.png`, `a3-05-past-sessions.png`

The DB agrees: 8 `session_mistakes` rows, `en-past-simple-tense` present in 4 distinct sessions, so the
next session Alan closes says `seen 5×` — with every number behind it a row.

## 2026-10-23 (late) — changing language by asking, proven end to end

The picker toggle was the wrong interaction for a speaker product, so the language is now a
property of the **session** that the learner can change with their voice. `npx tsx
scripts/language-switch-proof.ts` against the live proxy server (real calls, nothing mocked):

```
[open in French] 4.8s · language=fr · French
  Bonjour ! Tu as trouvé quelque chose de spécial au marché ?
[reply in French] 5.3s · language=fr · French
  Des fraises et du pain, parfait ! Les fraises étaient bonnes ?
[ASK FOR GERMAN] 3.2s · language=de (CHANGED) · German
  Okay, Deutsch ab jetzt! Die Erdbeeren waren bestimmt süß, oder?
[reply in German] 4.7s · language=de · German
  Ah, Anna! Ich erinnere mich, dass ihr zusammen kocht. Was habt ihr heute Abend vor?

[end_session] path=llm
  summary: The learner discussed visiting a market and buying strawberries and bread in French.
           They then switched to German to mention that their girlfriend is named Anna and they
           cook together.
[past sessions] this session is tagged: ["fr","de"]
```

Four things that only show up in a run like this: the acknowledgement clause is in the NEW language
(not a translation of the request); the German turn *recalled the strawberries from the French
turn*, so the thread really is unbroken; the summary names both languages instead of pretending the
session was one; and the stored tag is a list, which is what `list_sessions.languages[]` renders as
`fr → de` in Past sessions.

`scripts/run-qa.sh` now replays this proof on its own isolated server and gates on it, so the pre-flight
on recording morning says `[switch] spoken request changed the session: PASS` next to the money-shot
verdicts rather than leaving Beat 7b to be discovered live.

### What was built

- `src/persona/languages.ts` — names/aliases in 10 languages (each language's own word for itself
  included: `allemand`, `coreano`, `日本語`), `normalizeLanguageCode()`, and `detectLanguageSwitch()`.
- `chat` resolves language from the **stored session**, then an explicit `targetLanguage`, then the
  words of the message. Returns `language`, `languageName`, `languageChanged` (all declared in
  `outputSchema` — an undeclared field is a `-32602`, not a free add).
- `set_language` — the 6th tool, for a client that already understood the request.
- `messages.language` (idempotent `ALTER TABLE` on open, so existing DB files keep working) →
  `end_session` tells the review prompt when a session covered two languages.
- Sim adopts the server's language instead of wiping the transcript, rebinds TTS/STT to it, and
  renders `⇄ now speaking French` on the turn where the server reported the change.

### Detection: 22 must-switch / 19 must-not-switch shapes (`tests/languages.test.ts`)

Two-stage on purpose — find a token that IS a known language, then require a **request** shape next
to it. The negatives are the load-bearing ones, because a language-practice conversation is mostly
*mentions* of languages: "I speak French at work", "what's the word in Spanish?", "how do you say
thank you in Korean", "I usually practice Vietnamese on Sundays", "my French is not very good" must
all leave the session alone. Requests that work include `let's speak French`, `switch to Spanish
please`, `I want to speak Spanish`, `parlons français`, `lass uns deutsch sprechen`, `hablemos
español`, `passe au allemand`, `nur Deutsch bitte`, and `let's switch to pt`.

Bugs found while building it, each now a comment in the source:
- A module-level cue regex with the `/g` flag carries `lastIndex` **between calls**, so cues near the
  start of a later message were silently missed. 18 of 18 positives "failed" for this one reason.
- `practi[sz]e` never matched "practice" — the letter is a **c**, not s/z — and `spa[kz]t` never
  matched "spoke". Abbreviated character classes hid a whole class of misses; the self-report guard
  is now spelled-out word lists.
- Cue matching by `includes()` is unsafe: "essay" contains "say", "know" contains "now". Cues get
  word-boundary lookarounds.
- Bare 2-letter codes are English function words (`it`, `de`), so a code only counts after an
  explicit change verb; "Let's do it in French" skips the `it` candidate and finds `french`.

### Known limits (stated, not hidden)

- Under-claiming is the failure mode everywhere: an unrecognised phrasing means Sala keeps speaking
  the old language and answers the question as content. It never switches to something unasked.
- Mistake identity is prefixed with the session's language **at the time of the review**, so a
  session that switched mid-way can under-count a repeated mistake class (`fr-past-…` will not match
  earlier `en-past-…` rows). Counts only ever come from real rows, so this can never inflate.
- Piper has voices for en/fr/de on this box (downloaded models, `data/piper-voices/`). A spoken
  switch to a language with no local model — Spanish, on the recording machine — has NOT been
  listened to yet: the server side and the captions follow, what the audio does is checked below
  and recorded as it turns out.
