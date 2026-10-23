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
view for **Beat 4b** below (the one deliberate wire-inspector shot), then `d` again to come back.
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

Screen: flip the language picker to Français. Tap the mic (listening state, orb pulse). Speak
one short French turn: "Salut Sala ! Hier je suis allé au marché avec ma sœur." Manual stop.
Sala replies in French by voice (Piper label in the footer on Dylan's Linux box; browser voice
on macOS/Windows). Mic re-arms after speech ends.
VO (over the exchange, low):
> "Half-duplex, like a real conversation: Sala never talks over you. The mic re-arms only after
> it finishes speaking. Same MCP path as the text turns. The inspector shows the identical
> JSON-RPC under both."

Quiet room. One rehearsed sentence, spoken slowly. Background noise causes mis-transcripts or
no-speech ends.

### Beat 6 — end_session review panel (1:50-2:20) [PROXY]

Screen: press End session. Button reads "Generating review…".
**Edit: cut this wait.** On the live take it is 28-41 s of LLM extraction. Cut from the click to
the rendered panel. Never speed-ramp it; a cut is honest, a timelapse of a spinner is not
misleading either but the cut reads cleaner.
On screen: review panel. Vocabulary cards quoting the learner's own sentences verbatim
("Yesterday I go to climbing wall and I am very tire after."), grammar pairs: YOU SAID /
NATURAL with the one-line explanation, `path:` line under the panel.
VO:
> "This is the product. The review is extracted from what was actually said this session: your
> own sentences as the examples, the mistakes you actually made as the grammar points. If you
> made none, the grammar section says so instead of inventing teaching points."

### Beat 7 — Past sessions persistence (2:20-2:40) [PROXY]

Screen: switch to the Past sessions tab. Yesterday's session (seeded before recording, one
honest prior session from rehearsal is fine: it IS a real prior session) with its language tag
and stored review, expandable.
VO:
> "Every session stays. The DB file is the whole account: one file, portable, private, yours to
> copy or delete. There is no third-party Alexa+ memory API for add-ons, so your memory living in
> a file instead of someone else's graph is the architecture, not a workaround."

### Beat 8 — Close (2:40-3:00) [PROXY]

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
7. **Latency:** chat turns run 3-14 s on the proxy. Speak or type, then breathe. Do not
   hammer Send. End session is the 28-41 s cut (Beat 6).
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
   `end_session`, which is why it measures 22-47 s on camera. Say: **"Alexa+ handles the listening and
   the speaking. Our add-on gets text back, and when a session closes the whole transcript is re-read
   to build the review — one pass, before the panel appears."** If you want the pause to look deliberate
   instead of like a stall, use the Beat 6 cut-around already in this runbook.

4. **"tracking of recurring grammar mistakes" / "Alexa mentions the problem that persists"** (Beat 3
   and the hook). Nothing compares a mistake against previous sessions. `end_session` reviews the
   current transcript; past reviews are stored and listed by `list_sessions`, but no code notices a
   repeat. Either cut that beat, or show what is really there: **the review quoting the learner's own
   sentence, then `list_sessions` with yesterday's panel still on file.** Do not perform a persistence
   feature we did not build — a judge cloning the repo will grep for it. Filed as an issue.

5. **"keeping response times ultra-fast and staying well within token constraints."** Chat turns are
   fast, the review is not. Claim the retrieval discipline instead: **"only the relevant recalled
   context goes into the prompt, so the conversation stays cheap and quick. The review is the one slow
   call, and it is worth waiting for."**

Bonus filming note: the demo lines in 0:40-1:15 say the target language is German but the learner's
spoken lines are English. Pick one. If Alan wants his own ESL story the learner speaks English errors
and Sala recasts in English; if German, his lines must be German (the recast quality is verified —
"Gestern bist du mit deinem Freund in den Park gegangen und habt Fußball gespielt?"). The on-screen
language and the `targetLanguage` chip must agree, and the "Simulated Alexa+ experience" label stays in
frame the whole time.

Also careful in the hook: "Without long-term memory, every chat resets to zero — there's no tracking of
recurring grammar mistakes" asserts what Alexa+ does not do. We have not measured Alexa+ itself. Frame
it as what the add-on adds, not as a defect claim about Amazon's product.
