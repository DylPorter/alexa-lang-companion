# Demo video script + recording runbook (<3 min)

Owner: **Alan** records, cuts, publishes (public YouTube/Vimeo, link in the Devpost form).
Dylan's machine hosts the demo. Every review and every reply on camera is extracted live from
the conversation actually had on camera. Nothing staged, nothing scripted into the server.

Backend note for every beat: **the whole video runs on the proxy LLM backend
(`SALA_LLM=proxy`). No beat requires Bedrock.** Bedrock is the AWS Builder mini-challenge
evidence and lives in the form text, not the video. If Bedrock happens to be enabled by
recording day, swapping `SALA_LLM=bedrock` changes nothing on screen except the `/health`
footer word.

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
> "The server behind this is a real self-hosted MCP server over Streamable HTTP, protocol
> 2025-11-25, the version Alexa+ for Builders speaks. In production Alexa+ is the MCP client
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
> "Every session stays. The DB file is the whole account: portable, private, self-hosted. There
> is no third-party Alexa+ memory API for add-ons, so your memory living in your own file is the
> architecture, not a workaround."

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
   the Piper fallback is missing, which is what we want on Linux). Backend: proxy, from the
   gitignored `.env`. Confirm `curl -s http://127.0.0.1:3100/health` says `proxy` before
   recording.
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
