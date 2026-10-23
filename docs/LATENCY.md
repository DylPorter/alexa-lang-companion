# Sala — measured LLM latency (2026-10-23)

Instrument: `scripts/latency-probe.ts` (`shapes` | `bench` | `stream` | `models`), against the
real gateway in `.env` (`ANTHROPIC_BASE_URL` + token, model `qwen3.8-flash`), with the **real**
review system prompt and the real `ESL_ENGLISH_FIXTURE`. Wall clock, end to end, nothing
estimated. Reproduce with:

```sh
npx tsx scripts/latency-probe.ts shapes 1     # which request shape the gateway honours
npx tsx scripts/latency-probe.ts bench 3      # medians through the actual ProxyLLM code path
SALA_CHAT_THINKING=off npx tsx scripts/latency-probe.ts bench 3
npx tsx scripts/latency-probe.ts stream       # stream:true capability (finding only)
npx tsx scripts/latency-probe.ts models       # which model ids the gateway exposes/accepts
```

## The one lever that mattered: reasoning off for the extraction pass

`end_session` was taking **22-47s** (README's honest-limitations line). Root cause was already
proven by `scripts/review-raw-blocks.ts`: this gateway emits a `thinking` block before any `text`,
and `max_tokens` bills both. The fix is to stop asking for reasoning on a call that has nothing to
reason about — the review is a deterministic JSON extraction over a transcript handed to it whole.

Request shapes, review phase, one rep each (`shapes` mode, this run):

| request shape | wall | blocks | out tok | verdict |
|---|---|---|---|---|
| no `thinking` field (the old behaviour) | **33.6s** | `thinking:4535`, `text:1740` | 1620 | JSON parses |
| `thinking:{type:"disabled"}` | **5.7s** | `text:1746` | 447 | JSON parses, `end_turn` |
| `thinking:{type:"enabled",budget_tokens:1024}` | 21.3s | `thinking:1944`, `text:1718` | 948 | honours the budget |
| `thinking:{type:"enabled",budget_tokens:512}` | 24.2s | `thinking:1577`, `text:1730` | 964 | honours the budget |
| `enable_thinking:false` (OpenAI-style, top level) | 35.7s | `thinking:9007`, `text:1872` | 2884 | **HTTP 200, IGNORED** |
| `chat_template_kwargs:{enable_thinking:false}` | 48.8s | `thinking:12180`, `text:1803` | 3497 | **HTTP 200, IGNORED** |
| `thinking:{disabled}` + `max_tokens:1024` | 5.6s | `text:1762` | 454 | parses — cap is not a time lever |
| reduced-output prompt, thinking ON | 53.8s | `thinking:11353`, `text:1537` | 3559 | slower, not faster |
| reduced-output prompt + thinking disabled | 9.7s | `text:1480` | 387 | within noise of 5.7s |

Second, independent run of the same instrument (parent session, earlier the same morning):
default 26.4s (`thinking:2742`,`text:1745`) → `thinking:{type:"disabled"}` **6.7s** (`text:1894`,
out=489, parses); reduced-output prompt + disabled 8.6s; `enable_thinking:false` 20.2s partial;
`chat_template_kwargs` 40.5s ignored.

**Only the Anthropic `thinking` field is honoured by this gateway.** The OpenAI-style qwen flags
return HTTP 200 and are silently dropped from the request — the thinking block is still there,
sometimes longer, so a "200 OK" tells you nothing. That is the trap worth remembering: an ignored
flag looks like a working one.

## End-to-end medians through the real code path (`bench 3`, 3 reps/phase)

| phase | before | after (shipped config) |
|---|---|---|
| **review** (`end_session` LLM pass) | 36.9 / 50.0 / 47.9 → **median 47.9s** | 6.3 / 7.0 / 5.6 → **median 6.3s**; second run 7.9 / 7.9 / 6.5 → 7.9s; **6.75s over all 6 samples** |
| **chat** (one conversational turn) | 3.4 / 5.2 / 3.3 → **median 3.4s** | 6.0 / 3.8 / 7.7 → **median 6.0s** — same code path, unchanged: the swing is gateway noise, not a regression |
| chat with `SALA_CHAT_THINKING=off` | — | 0.8 / 0.8 / 0.9 → **median 0.8s** (knob, not the default) |

`review` is **~7x faster** (47.9s → 6.3-7.9s). Zero empty replies, zero heuristic fallbacks, all
six after-run replies parsed as JSON. Raw per-rep lines, so the chat noise claim can be checked
rather than taken (`bench` chat row: `6.0 / 3.8 / 7.7` vs `before` `3.4 / 5.2 / 3.3` — the shipped
chat code path is byte-identical across those two runs, so the difference is the gateway):

```
before (HEAD, thinking at gateway default):  [review] 36.9 / 50.0 / 47.9   [chat] 3.4 / 5.2 / 3.3
after  (thinking off for review):            [review]  6.3 /  7.0 /  5.6   [chat] 6.0 / 3.8 / 7.7
after, second run:                           [review]  7.9 /  7.9 /  6.5   [chat] 0.8 / 0.8 / 0.9  <- SALA_CHAT_THINKING=off
```

**Shape caveat, because it matters for reading the chat numbers:** `bench` calls the real
`ProxyLLM` with the real `chatSystemPrompt(cfg, …)` and a multi-turn message array (6 fixture
messages + a fresh user turn = 7). The server sends up to 12 transcript messages **plus** a
`<<RECALLED>>` block when FTS hits, so a live camera turn can be a bigger prompt than this probe —
the review shape, by contrast, is exactly what `extractReview` sends (one `TRANSCRIPT:\n…` user
message, verbatim prompt). Chat is therefore an upper-bound-free estimate; review is faithful.

## Independent re-run (parent session, same instrument, gateway otherwise idle)

`npx tsx scripts/latency-probe.ts bench 3` twice back to back, `SALA_CHAT_THINKING=off` first:

```
chat thinking OFF:  [review]  6.3 /  5.5 / 15.7 → median 6.3s   [chat] 1.7 / 0.8 / 0.9 → median 0.9s   chars 49 / 52 / 80
chat thinking ON :  [review]  7.0 /  6.6 / 6.2 → median 6.6s    [chat] 5.0 / 9.4 / 5.7 → median 5.7s   chars 133 / 100 / 148
```

Review corroborates: **6.3-6.6s median**, eleven samples across three runs, one 15.7s outlier with
nothing else competing for the gateway. Empty replies: zero.

**The chat knob has a price the earlier run did not measure.** Reply length roughly halves with
reasoning off (49-80 chars vs 100-148) — the same probe, the same prompt, three reps each. Speed was
never the only variable in that comparison, and for a product whose pitch is comprehensible input,
half the language per turn is a real cost. So: **film with the default** (5.7s chat turns are
comfortable inside a live take, and the voice beat spends time on TTS anyway). Reach for
`SALA_CHAT_THINKING=off` only if a specific take needs to snap, and read one reply aloud first.
Running `bash scripts/run-qa.sh` with the knob set did hold the persona contract by eye (one recast
per exchange, honest refusal on the un-logged Japan trip, a correct French `vous êtes allés`), but
probes P1-P5 are printed for a human to read, not asserted, so that is one judgement, not a green mark.

## The money shot, live, on the fast path (`bash scripts/run-qa.sh`, isolated server on :3101)

Real sessions, real backend, fresh DB — the probe prints its own wall clock per review:

```
===== P6 French review (money shot, FR) — extraction=llm 10.4s =====
[P6-FR] verbatim-from-transcript: PASS (5/5)
===== P7 ESL exchange (tense + comparative + plural errors) =====
===== P7 ESL review (money shot, EN) — extraction=llm 4.7s =====
[P7-EN] verbatim-from-transcript: PASS (5/5)
===== P8 German exchange (verb position + past participle + superlative) =====
===== P8 German review (money shot, DE) — extraction=llm 8.9s =====
[P8-DE] verbatim-from-transcript: PASS (7/7)
[P6/P7/P8 money shot] verbatim integrity: FR=true EN=true DE=true
run-qa: all verdicts PASS · full transcript: /tmp/sala-qa-run.log
run-qa: no review fallbacks — every money shot came back on the LLM path
```

Three languages, `extraction=llm` on all three, verbatim integrity 5/5 · 5/5 · 7/7, zero heuristic
fallbacks, reviews in 4.7-10.4s (the FR/DE transcripts are longer than the EN fixture). The
README's honest-limitations line has been corrected to this by its own author; still stale against
these numbers (and not this lane's file to edit): `docs/DEMO-SCRIPT.md:90` ("On the live take it is
28-41 s of LLM extraction") and `docs/DEMO-SCRIPT.md:147` ("End session is the 28-41 s cut").
Worth updating before the take, because the beat direction changes — a 5-10s wait is something you
can let run on camera instead of cutting around. First byte of a streamed reply is ~1.4-1.9s (see
Streaming), which is the number the half-duplex voice beat actually waits on.

## Shipped configuration

- `thinkingForPhase("review")` → `{thinking:{type:"disabled"}}` (`src/llm/types.ts`).
- `thinkingForPhase("chat")` → sends **no** `thinking` field, i.e. the gateway's own default,
  because the persona is the quality-critical surface on camera and it already answers in ~3-6s.
  The 0.8s number above is real but measured on reply *length*, not reply *quality* — flipping it
  is one env line (`SALA_CHAT_THINKING=off`), so decide it deliberately before a take, not in code.
- Per-phase model routing `SALA_REVIEW_MODEL` / `SALA_CHAT_MODEL` (→ `SALA_MODEL` →
  `ANTHROPIC_MODEL` → backend default). A model id injected into the `ProxyLLM` constructor beats
  all of it, which keeps the offline suite hermetic. **Not used in the demo config** — no faster
  model id was needed once thinking went off, and the `models` probe below is the evidence for why
  guessing one is a bad bet on this gateway.
- `max_tokens` unchanged (`review: 8192`, `chat: 2048`). The cap is not what costs time — 1024 and
  8192 measured the same once thinking was off — and lowering it is how the silent heuristic
  fallback got in there in the first place (`tests/llm-budget.test.ts`). Review keeps the full
  headroom precisely because a gateway that ignores the flag must still not truncate.
- Request timeout 60s → 150s (still under the sim's 180s tool timeout), so a slow gateway fails
  with a named error instead of the client timing out over a call still running.

## Not shipped, with the reason

The payload-compaction lever (cap 5 vocab items, one-sentence notes, `<140` summary) is **within
noise** once thinking is off — 9.7s vs 5.7s on one rep each, 8.6s in the second run — and it cuts
the thing the panel is there to show. `tests/persona.test.ts:81` also pins the literal
"4-6 vocabulary items" range, so a hard cap of 5 would fight a test this lane does not own.
Left alone deliberately; the field-length caps in `reviewSystemPrompt` stay as they were.

## Streaming: `stream: true` IS supported (finding only — not implemented)

`scripts/latency-probe.ts stream`, review prompt, 2026-10-23:

| request | HTTP | total | first byte | deltas seen |
|---|---|---|---|---|
| `stream:true`, thinking at gateway default | 200 | 50.0s | 1.4s | `text_delta` **and** `thinking_delta` |
| `stream:true` + `thinking:{type:"disabled"}` | 200 | 6.4s | 1.9s | `text_delta` only, no `thinking_delta` |

Full Anthropic SSE event sequence arrives intact: `ping, message_start, content_block_start,
content_block_delta, content_block_stop, message_delta, message_stop`. So **the two delta types are
distinguishable** — a client could show a "thinking" affordance separately from the answer, or drop
`thinking_delta` entirely. First byte in ~1.4s is the interesting part for the *chat* surface (the
sim could start speaking/typing the reply almost immediately instead of waiting 3-6s), but the
review panel cannot render until the JSON is complete, so streaming does not fix the money shot —
not thinking did. `ProxyLLM.invoke` still parses a non-streamed body; nothing here is wired.

## Model ids: the gateway has no catalogue and rejects unknown names loudly

`scripts/latency-probe.ts models`:

- `GET /v1/models` and `GET /models` → **HTTP 404** `{"code":"InvalidParameter","message":"Not support"}`.
  There is no way to discover what this proxy serves; you have to know the id.
- `qwen3.8-flash` → 200. Even a 16-token ping came back `stop_reason=max_tokens` with a
  `thinking:46` block — this model reasons unless the request says not to.
- `qwen3.8-flash-nothink`, `qwen3.8-flash-instruct`, `qwen3-30b-instruct`, `qwen3.8-flash-max` →
  all **HTTP 400** `{"code":"InvalidParameter","message":"Model not exist."}`.

Consequence for `SALA_REVIEW_MODEL`: a guessed id fails with a 400, `ProxyLLM` throws, and
`extractReview` falls back to the heuristic panel (it logs `[review] LLM pass failed, using
heuristic:`). That is a visible degradation, not a silent wrong answer — but on recording day it
means **only set `SALA_REVIEW_MODEL` to an id you have just probed with this script.** No model
swap is used in the demo config; disabling reasoning made it unnecessary.
