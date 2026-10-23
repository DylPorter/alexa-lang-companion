# Demo video script + recording runbook (<3 min)

Owner: **Alan** records, cuts, publishes (public YouTube/Vimeo, link in the Devpost form).
Dylan's machine hosts the demo. Every review and every reply on camera is extracted live from
the conversation actually had on camera. Nothing staged, nothing scripted into the server.

Backend note for every beat: **the whole video runs on one live LLM backend and no beat requires
Bedrock.** Bedrock is the AWS Builder mini-challenge evidence and can live in the form text alone.
Whatever is live at record time, `/health` must confirm it before the first take — the backend word
in the footer and in `demo.sh`'s banner is the only on-screen difference.

**Record in the device view: `?device=1`** (see README → Presentation modes). The product is a
speaker in a living room, so the frame should read that way — orb leading, conversation full width,
the review appearing inline as a card instead of in a side pane. Press `d` to flip to the console
view twice at most — **Beat 4b** (the deliberate wire-inspector shot) and the 4 seconds of **Beat 7c**
(the Past sessions list, which device mode does not render) — and `d` again to come back each time.
The "Simulated Alexa+ experience" label stays on screen in both modes; never crop it out.

### Beat 4b — the runtime-evidence cut (12 s, inside Beat 4's window)

Cut to console view (`d`), scroll the inspector so a real `tools/call` row is visible with its
JSON-RPC payload, one line of VO: *"that conversation is not a mocked chat — it is a live MCP
client calling a real MCP server over Streamable HTTP, protocol 2025-11-25."* Cut back to device
view. This beat exists because the rules judge whether the required technology is actually called
at runtime, and an inspector frame answers that in a way narration cannot.

## Timeline (180 s budget)

### Beat 1 — Cold open (0:00-0:12) [PROXY]

Screen: title card over the sim home, "Simulated Alexa+ experience" pill visible.
VO (Alan or Dylan, one breath):
> "Voice language products died twice: nobody could discover them, and nobody could bill for
> them. Alexa+ fixes both. This is Sala, a living-room companion that learns your life and
> teaches you a language from it."

### Beat 2 — Architecture breath (0:12-0:28) [PROXY]

Screen: scroll the MCP tool-call inspector open, show `initialize` + one `tools/call` row.
VO:
> "The server behind this is a real MCP server over Streamable HTTP, protocol 2025-11-25, the
> version Alexa+ for Builders speaks. It's an HTTP endpoint, so it runs wherever you want it —
> your own machine, your own server, any host you pick. In production Alexa+ is the MCP client
> and does the understanding and the talking. This web app simulates that device side: the
> voice layer simulates Alexa+'s device-side ASR/TTS, and the MCP server receives text, exactly
> like a real Alexa+ add-on."

Edit: hold the inspector footnote on screen for the honesty line. One `GET → 405` row may be
visible: it is the SDK's SSE-listen probe against the stateless transport, harmless. If it
distracts, frame tighter; do not hide the inspector itself.

### Beat 3 — Seed + memory beat (0:28-0:50) [PROXY]

Screen: type into the activity logger: "I went to the gym and tried the climbing wall for the
first time". Log. Then in the composer: "Hi Sala! I just got back from the gym."
On screen: the reply references the climbing wall and the "remembered" badge appears.
VO:
> "Sala stores what you tell it. The badge only appears when the server genuinely retrieved
> something. Ask about a trip it never heard about and it says it has nothing stored."

Rehearsal note: the opener must repeat a keyword from the logged activity ("gym"). Recall is
FTS5 keyword + recency, not semantic. "I just got back from the gym" matches. "I exercised"
does not.

### Beat 4 — Natural turns with one visible recast (0:50-1:20) [PROXY]

Screen: two or three typed turns in English. Include exactly one mistake turn, e.g.
"Yesterday I go to climbing wall and I am very tire after." Sala recasts inline:
"You WENT to the climbing wall and came home super TIRED? …" and keeps asking about the day.
VO:
> "A friend, not a tutor. One gentle recast per exchange, maximum, and the conversation keeps
> moving. The recast is also the raw material for the review at the end."

### Beat 5 — Voice mode exchange (1:20-1:50) [PROXY]

Screen: stay in device view. Tap the mic (listening state, orb pulse). Speak one short English
turn: "Hey Sala, yesterday I went to the market with my sister." Manual stop. Sala replies by
voice (Piper label in the footer on this box; browser voice on macOS/Windows), mic re-arms after
speech ends.
VO (over the exchange, low):
> "Half-duplex, like a real conversation: Sala never talks over you. The mic re-arms only after it
> finishes speaking. Same MCP path as the text turns; the inspector shows the identical JSON-RPC
> under both."

**Stay in English through this beat and Beat 6.** Changing language mid-session is the feature
(Beat 7), but doing it here would re-key this session's mistake identities under the new language
and the recurrence chip in Beat 6 would not fire. Sequence matters, it is not a limitation.
Quiet room. One rehearsed sentence, spoken slowly. Background noise causes mis-transcripts or
no-speech ends.

### Beat 6 — end_session review panel (1:50-2:20) [PROXY]

Screen: press End session. Button reads "Generating review…".
**Edit: keep the wait in one shot now.** Measured 2026-10-23, the extraction pass runs **5-10 s**
(median 6.3-6.6 s over eleven samples; it was 22-47 s until reasoning came off that call —
[docs/LATENCY.md](LATENCY.md)). Six seconds of "Generating review…" reads as the product thinking, so
film it. If a take lands over ~20 s, cut from the click to the rendered panel; never speed-ramp, a cut
is honest and a timelapse of a spinner is not misleading either but the cut reads cleaner.
On screen: review panel. Vocabulary cards quoting the learner's own sentences verbatim
("Yesterday I go to climbing wall and I am very tire after."), grammar pairs: YOU SAID /
NATURAL with the one-line explanation, `path:` line under the panel.
VO:
> "This is the product. The review is extracted from what was actually said this session: your
> own sentences as the examples, the mistakes you actually made as the grammar points. If you
> made none, the grammar section says so instead of inventing teaching points."

### Beat 7 — You just ask: memory and language, said out loud (2:20-2:45) [PROXY]

The beat that makes this a speaker product rather than a chatbot with an orb on it. Two asks, both
spoken, both in the device view, and neither one touches a control.

**7a — cross-session memory, asked (2:20-2:31).** Beat 6 closed its session, and the sim starts a
fresh one on the next message (just talk, no reset button). Say or type:
> "Did I ever tell you which route I fell on at the climbing wall?"

On screen: Sala names the route from the session that already ended, and the `✦ remembered` badge
appears. That badge renders **only** off the server's `memoryReferenced` flag, which is true only
when FTS5 genuinely retrieved stored rows — so the badge IS the rehearsal check. No badge, no take:
re-word the question so it shares a keyword with what was really said ("climbing wall", "route",
"gym"). Recall is keyword + recency, not semantic — "did I tell you about exercise?" returns nothing,
and Sala says it has nothing stored. That refusal is the same feature; half a line on it is free.

**7b — change language by asking (2:31-2:38).** Same new session:
> "Actually, let's speak French."

Sala answers in French, out loud, opening with one short clause acknowledging the switch ("Okay,
français à partir de maintenant!"), and a `⇄ now speaking French` pill renders above the reply. The
conversation is never restarted, the picker is never touched, and the device voice rebinds to the
French Piper model with that reply. For the architecture cut, the explicit call is `set_language`,
sitting on the tool list beside `chat`.

**7c — 4 s of B-roll for the persistence line.** Cut to the Past sessions list (device-view warning
below), one card open showing its stored review and its `en → fr` language tag, then back out.
VO (running across 7a-7c):
> "Sala remembers across sessions because you asked it to, and you change language the way you'd
> tell a friend. Every session stays — the DB file is the whole account: one file, portable,
> private, yours to copy or delete. There is no third-party Alexa+ memory API for add-ons, so your
> memory living in a file instead of someone else's graph is the architecture, not a workaround."

**Camera notes for 7b, measured in the browser 2026-10-23 (all fixed, no manual fiddling needed).**
The `⇄ now speaking French` pill sits at the TOP of Sala's bubble, and the pane used to pin itself to
the bottom — so the shot that matters left the frame after two exchanges. The pane now scrolls the
newest pill into view by itself: do not scroll during the take, and do not "help" it, a second scroll
will move it back out. French is the spoken language for this beat on purpose: Piper has local voices
for en/fr/de only, so a spoken switch to Spanish switches the reply, the pill, the picker and the
transcript tags but produces **no audio** (the server answers HTTP 400, verified). Keep Spanish for
the typed/architecture mention, not for the spoken money shot. Same pass fixed the presence orb's top
edge being clipped off-frame, and the status line under it, which said "say hi to start" between every
turn of a live conversation; it now reads "ready when you are" once the session has exchanges.

**Verified 2026-10-23: the Past sessions tab does not exist in `?device=1`.** Device mode mounts no tabs
at all (no `.tab`, no `[role=tab]` — the admin column isn't rendered), so 7c is shot either by
toggling out with `d` or from the plain `http://localhost:5199` page, then back into device view. Do not
discover this mid-take. Same check also found the chip's amber-on-amber-soft pill reading under WCAG AA at
10.5px, so the recurrence elements now draw in `--amber-on-soft` (`#f5c987`, 5.4-7.3:1 depending on which
way you composite the translucent plate) — see `docs/a2-qa.md`.

Rehearsal note for 7b: "switch to French" is in the tested table; "maybe we could do French
sometime?" is not — and it *should not* switch, that is the false-positive guard. Don't paraphrase
the line into something softer on camera, and don't ask it in French: the request is recognised in
five languages, but the shortest phrasing is the safest transcript. The ask now also works as a
session's very first words (issue #4, fixed and proven in `run-qa`), but keep the order written above:
7a's badge is the memory proof, and a switch in the opening line would spend it.

### Beat 8 — Close (2:45-3:00) [PROXY]

Screen: home view, inspector open, honesty pill visible.
VO:
> "On real Alexa+ hardware, the MCP Apps extension is where these review cards would render
> inside the conversation view. We built the server first and the room second. Sala: Dylan
> Porter and Alan Atiyev, for Amazon Build, Ship, Shape."

Hard stop at 3:00. Judges are not required to watch past it, so nothing load-bearing lives
after 2:40.

## Recording runbook (Dylan's machine, morning of)

1. **Start clean.** `rm data/sala.db*` for a fresh learner, then seed exactly the activities
   the script references. Rehearse the whole script once on the fresh DB before recording,
   then decide: re-record on the rehearsed DB (it is still honest: those turns really happened
   minutes earlier) or wipe and re-seed. Either is fine. Staging fake history is not.
2. **Boot:** `PORT=3100 SIM_PORT=5199 npm run demo:voice`
   (3000 and 5173 belong to other processes on this machine; `demo:voice` also fails loudly if
   the Piper fallback is missing, which is what we want on Linux). The backend comes from the
   gitignored `.env` (`SALA_LLM`), and `demo.sh` now prints which one it resolved — treat that
   banner as the pre-flight. Confirm `curl -s http://127.0.0.1:3100/health` agrees before
   recording, then open `http://localhost:5199/?device=1` for the takes.
   If the banner and `/health` disagree, stop: you are looking at a different backend than the
   one you think you are recording, and `demo.sh`'s old default used to cause exactly that.
3. **Browser:** Chrome or Edge, windowed at 1920x1080, dark theme as shipped. On this Linux box
   TTS comes from local Piper (footer labels it honestly); on a Mac/Windows machine the browser
   system voices take over automatically and Piper stays idle.
4. **Mic permission BEFORE recording:** tap the mic once, allow the browser prompt, say one
   throwaway sentence, confirm the transcript lands, then `rm data/sala.db*` and re-seed.
   A denied or un-asked prompt mid-take kills Beat 5.
5. **Quiet room.** The browser streams audio to its speech service. A fan or a TV in the
   background becomes part of your transcript.
6. **Never on camera:** the `?voicedebug=1` STT test double form (headless QA only), any `.env`
   or terminal with tokens, the browser bookmark bar, other tabs. Check the frame edges.
7. **Latency (re-measured 10-23, `docs/LATENCY.md`):** chat turns median **5.7 s** on the proxy
   (5.0/9.4/5.7 — the 9.4 s rep is gateway variance, not the prompt), End session is a **5-10 s** wait
   that now fits inside the take. Speak or type, then breathe. Do not hammer Send. `SALA_CHAT_THINKING=off`
   makes turns ~0.9 s but roughly halves the reply length, so it is a last-resort knob for one take, not
   the config to record the whole video in.
8. **If a turn misfires** (empty proxy reply, mis-transcript): stop, fix, re-run that beat on
   the same DB and cut in edit. The server already retries empty replies once.
9. **After recording:** `end_session` reviews shown on camera came from the takes you kept.
   Re-verify each quoted sentence appears in the kept conversation before publishing.
10. Kill the stack when done (the concurrently parent, then confirm ports 3100/5199/5055 are
    free), and `rm data/sala.db*` if the next session should start fresh.

## Live demo for Alan (same morning, before recording)

Same commands, no camera: `PORT=3100 SIM_PORT=5199 npm run demo:voice`, open
`http://localhost:5199`, walk Beats 3-7 interactively with Alan driving the keyboard. He gets
the latency feel (proxy turns, the End session wait) and the mic rehearsal in one pass. Then he
cold-runs on his own machine per the README teammate guide: echo mode first with zero secrets,
then proxy mode with creds handed over privately, never in chat.

## Alan's 2026-10-23 rewrite — five lines that must not go out as written

The structure is better than ours (problem hook → solution → demo → next-day check-in → architecture →
outro, and it fits 2:15). Keep it. These claims are not true of the build, and the video plus the form
go public, so swap the wording. Verified against the source on 10-23, not from memory.

1. **"It runs entirely on the Alexa hardware you already own with no extra subscriptions or apps
   required."** We have never run on an Alexa+ device, and the rules require the video to clearly show
   a *simulated* experience. Say: **"It's an Alexa+ add-on — an MCP server you run on whatever host
   you choose, so no extra subscription and no app to open. The speaker you already own is the
   interface."** (Deliberately not "self-hosted" in our own copy: the rules use that word for the
   track, but nothing says Amazon can't run the server later. "Hosted anywhere" is the product claim
   and it is equally true of the compliance claim. See docs/SUBMISSION.md.)

2. **"Long-Term Memory / Vector DB"** in the architecture visual, and any mention of embeddings. There
   is no vector database. `src/memory/db.ts` is SQLite + FTS5 keyword search with bm25 and recency,
   deliberately, and the SPEC calls it honest simplicity. Say: **"keyword recall with recency ranking
   over one SQLite file the user owns."** The portable-single-file-DB story is *stronger* than a
   borrowed vector-DB buzzword, and it is checkable in the repo.

3. **"decouples real-time voice streaming from long-term memory"** and **"an asynchronous background
   task extracts..."**. Audio never reaches a third-party add-on at all — the device streams to Amazon's
   cloud, and Alexa+ does the ASR, the response generation and the UI (verified from the MCP Toolkit
   overview and quoted in SPEC.md). And the extraction is not asynchronous: it runs inline inside
   `end_session`, which is why it measured 22-47 s on camera. **That is fixed as of 10-23** — the
   extraction pass stopped reasoning, and it now runs 5-10 s (`docs/LATENCY.md`), so the wait is short
   enough to sit inside the take. Say: **"Alexa+ handles the listening and the speaking. Our add-on
   gets text back, and when a session closes the whole transcript is re-read to build the review — one
   pass, before the panel appears."**

4. **"tracking of recurring grammar mistakes" / "Alexa mentions the problem that persists"** (Beat 3
   and the hook). ~~not built~~ **built the same day this was flagged** (commit `8a86e84`, issue #2
   closed), so the beat is back — but it only fires on a real repeat, which changes how the take must
   be set up. What the code does: every grammar point carries a `mistakeId`, and when the SAME id is
   already stored for an **earlier** session the point gains `recurrence.seenInSessions` (a
   `COUNT(DISTINCT session_id)` over rows written before today's, read *before* this session's rows
   land) and the summary ends with "2 of these are mistakes you've made before, first logged on
   2026-10-23." The panel shows a `recurring · seen 2×` chip.

   `2×` above is the shape of the sentence, not the number to expect. Read off `data/sala.db` on
   2026-10-23: `en-past-simple-tense` is stored in **4 distinct earlier sessions**, so the next
   English close renders `recurring · seen 5×`. Never write the digit into the VO — say "it says how
   many times" and let the chip carry the number, because the number moves every time anybody
   rehearses. The same DB has 5 sessions left OPEN from browser testing (no review card, harmless in
   the 7c B-roll, and they are real conversations, not seeded rows).

   **So the recurrence on camera has to be earned, not staged.** Before the take, close 2-3 real
   sessions in the same target language that each contain the same mistake class — the past-tense one
   ("Yesterday I go to climbing wall and I am very tire") is the natural candidate because the
   heuristic table and the LLM label both fold onto `en-past-tense-adverb`. Do this in rehearsal, not
   in a seeded DB: a row written by a script is a lie with better formatting, and the chip's whole
   point is that the number came from conversations that actually happened. `rm data/sala.db*` only if
   you are throwing the whole day away.

   Wording: **"Sala keeps the identity of every mistake you make. Make the same one again in a later
   session and it says so — this is the second time, here's when it first showed up."** Do not say
   "it tracks all your recurring mistakes across the week": identity matching is exact-key, so two
   differently-worded LLM labels for one class can stay two identities. The failure mode is *silence*,
   never a count with no row behind it — which is the version worth filming anyway.

5. **"keeping response times ultra-fast and staying well within token constraints."** Chat turns are
   fast, the review is not. Claim the retrieval discipline instead: **"only the relevant recalled
   context goes into the prompt, so the conversation stays cheap and quick. The review is the one slow
   call, and it is worth waiting for."**

## New since the above was flagged — safe to claim on camera

Verified in the running build on 2026-10-23, not from the plan:

- **You change language by talking.** "Let's speak French", "switch to German", "lass uns deutsch
  sprechen", "hablemos español" all retarget the live session — same transcript, same session id,
  voice and review follow. `set_language` is the direct tool call for a client that already did the
  understanding. Evidence: `npx tsx scripts/language-switch-proof.ts` (a French session that asks for
  German mid-conversation, replies 3.2-5.3 s apart, review that says *"They then switched to German…"*,
  session stored as `["fr","de"]`), plus 22 switch shapes and 19 must-not-switch shapes under test.
  The one thing NOT to say: that it understands any phrasing. It recognises request shapes; a soft
  paraphrase is deliberately ignored so that "what's the word in Spanish?" can't hijack a session.
- **Mistake recurrence across sessions** (issue #2) — see claim 4 above.
- **Review latency is inside the take** — see claim 3 above.

Bonus filming note: the demo lines in 0:40-1:15 say the target language is German but the learner's
spoken lines are English. Pick one. If Alan wants his own ESL story the learner speaks English errors
and Sala recasts in English; if German, his lines must be German (the recast quality is verified —
"Gestern bist du mit deinem Freund in den Park gegangen und habt Fußball gespielt?"). The on-screen
language and the `targetLanguage` chip must agree, and the "Simulated Alexa+ experience" label stays in
frame the whole time.

Also careful in the hook: "Without long-term memory, every chat resets to zero — there's no tracking of
recurring grammar mistakes" asserts what Alexa+ does not do. We have not measured Alexa+ itself. Frame
it as what the add-on adds, not as a defect claim about Amazon's product.
