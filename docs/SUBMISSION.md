# Submission readiness — Devpost `amazonappdev2026` (Alexa+ track)

**VERIFIED from the official rules page (re-fetched 2026-10-20 for A3):**
`https://amazonappdev2026.devpost.com/rules`. The correct slug is `amazonappdev2026`.

**Deadline: Friday 23 Oct 2026, 12:00 pm Pacific = Sat 24 Oct 03:00 HKT.** Two-stage judging:
Amazon internal downselect (they read the friction log there) then a judge panel. Winners ≈ 3 Dec.

Owners: **Dylan** = build + product feedback + friction log + repo. **Alan** = description +
demo video + Devpost form.

## Alexa+ track compliance (verified verbatim 2026-10-20)

Track rule, verbatim from the rules page: *"Alexa+: Build a working Agent Skill or a self-hosted
MCP server, implementing MCP spec version (minimum acceptable version is 2025-11-25).
Optionally, developers can simulate the Alexa+ experience in a web app using their own agentic
tools."*

- **We satisfy the mandatory half outright:** a real self-hosted MCP server over Streamable
  HTTP, speaking protocol revision 2025-11-25 (the pinned SDK 1.32.1's `LATEST_PROTOCOL_VERSION`).
  The web sim is a genuine MCP client: the SDK is imported and the server is called at runtime,
  so the repo also satisfies the non-simulated reading of the track.
- **The sim is the sanctioned optional half:** "simulate the Alexa+ experience in a web app
  using your own agentic tools." The demo video must clearly show the simulated experience, and
  ours does: a persistent "Simulated Alexa+ experience" label in the UI plus one narration line.
- **Runtime-tech-hook:** the Alexa+ track path exempts us from a mandated runtime SDK import on
  the simulation route. Moot for us anyway, because the MCP SDK is imported and called at
  runtime (above). Note this honestly in the description: the exemption exists, and we exceed it.
- **Version three-way alignment (credibility beat):** track minimum (2025-11-25) = the version
  Alexa+ for Builders supports = the protocol our pinned SDK implements. The newer 2026-07-28
  revision is not implemented by any published SDK version.
- **New-&-existing rule:** projects must be new or significantly updated after 31 Aug 2026.
  Repo seeded 15 Oct, entirely inside the window. Clean-room declaration in README.

## Required submission pieces (form)

- [ ] **Demo video** — under 3 min (judges are not required to watch beyond that), must clearly
  show the simulated Alexa+ experience, **public on YouTube or Vimeo**, link in the form.
  Owner: Alan. Script + recording runbook: [DEMO-SCRIPT.md](DEMO-SCRIPT.md).
  - Integrity rule inherited from the fact-checker: nothing staged. Every review shown is
    extracted from the conversation that was actually had on camera.
  - The `?voicedebug=1` STT test double must never appear on camera.
- [ ] **Text description** — features + functionality. Owner: Alan. Source: README (it is
  written judges-facing).
- [ ] **Repo URL** — public + OSS license file (**MIT, present**), OR private + shared with
  `testing@devpost.com` **and** the Amazon DevRel GitHub users as collaborators (Settings >
  Collaborators > Add people): `knmeiss`, `giolaq`, `anishamalde`, `mosesroth`, `emersonsklar`
  (five usernames plus the devpost mailbox = six contacts; verified on the rules page 10-20).
  **Plan: public at submission.** Alan is added as a collaborator on the private repo now so he
  can cold-run the demo on his own machine (README has the teammate guide).
  The repo must contain all source, assets, and instructions to be functional.
- [ ] **Product Feedback (REQUIRED)** — five questions per tool/API/SDK used: (1) which tools
  and for what; (2) what worked well; (3) what needs work; (4) onboarding zero → hello world;
  (5) would you build with these again, Yes/No + why. Owner: Dylan.
  **DRAFT v1: [PRODUCT-FEEDBACK.md](PRODUCT-FEEDBACK.md)** (voice-checked). Before pasting:
  resolve the `[UPDATE-AFTER-ENABLEMENT]` marker for Bedrock and re-verify every claim.
- [ ] **Friction Log Entries (OPTIONAL, up to +10% judging bonus)** — per entry: specific task
  attempted / steps taken / expected vs actual / severity / workaround / actionable suggestion.
  Assessed by Amazon's internal review during Stage 1. Owner: Dylan. Canonical log lives in the
  vault (`Projects/Amazon Hackathon - Friction Log.md`, Sala sections A1/A2/A3).
  **Repo copy DONE 10-22: `docs/FRICTION-LOG.md`** (27 entries, Sala A1/A2/A3 + the Bedrock
  enablement + one self-disclosure about our own smoke). Cloud account identifiers are redacted in
  that copy because the repo goes public. Remaining: **paste the entries into the submission form
  text** on submission day — the form is where the Stage 1 reviewer reads them, the repo copy is
  corroboration.
- [ ] **Feature Requests (OPTIONAL)** — description / why it matters / priority. Cheap to lift
  from the friction log's "Suggestion" lines (SDK origin-allowlist semantics, SSE-listen skip in
  stateless mode, Chromium's phantom Linux TTS API, headless fake speech input).

## Mini-challenges

- [ ] **AWS Builder ($5k, 1 winner)** — *"Any primary track project that incorporates AWS
  services (Amazon Bedrock, AgentCore, Strands SDK, Kiro Crew, SageMaker, etc.) with documented
  integrations."* Our path: `BedrockLLM` (`src/llm/bedrock.ts`), a first-class core backend using
  `@aws-sdk/client-bedrock-runtime` converse API, documented in README + SPEC.
  **⛔ GATED on Dylan's human enablement step (below).** Without it the smoke prints GATED and
  the mini-challenge claim cannot be made. Mark it clearly in the form either way. Honest
  fallback if enablement never lands: the entry still stands on the Alexa+ track alone.
  Scoring note: "Obvious: single Bedrock call. Creative: multi-service pipeline, agentic
  architecture." Our shape (LLM backend swap with in-code validation of model output, memory
  retrieval feeding the prompt) is above the obvious bar. Write it up that way only if live.
- [ ] **Open Source ($5k, 1 winner)** — VERIFIED (via the firetv rules read): requires a **new
  additional OSS project or a contribution to an existing public repo made during the hackathon
  window (31 Aug – 23 Oct), alongside the primary submission.** MIT-licensing this repo does NOT
  qualify. **Decision: skip.** Plan changes only if a genuine upstream PR emerges from the build
  (candidates so far: an SDK doc patch on empty-`allowedOrigins` semantics). Never fabricate a
  contribution.

## Human step — gates AWS Builder only

**Dylan's AWS Bedrock enablement** (corrected 10-21 from the AWS docs):
1. **Nothing, for Nova.** Verified from the model-access doc: *"Amazon Bedrock starts the
   subscription for you on the first invocation, so there is no access request to submit"*, and the
   "Model access" console page *"applies to AWS GovCloud (US)"* only. The one-time use-case form
   (404 `FTUFormNotFilled` until filed) is **Anthropic-specific** — it is the reason not to default
   to Claude, and it is why the earlier version of this checklist had a step here. Prerequisites
   that DO apply to every provider: a valid payment method on the account, and
   `aws-marketplace:Subscribe|ViewSubscriptions` on the calling identity (the first invoke silently
   creates a Marketplace subscription; it can take ~15 min to settle).
2. **Model choice: `amazon.nova-lite-v1:0`, bare id.** Nova is In-Region in us-east-1, so no
   `us.` profile is needed and no IAM policy ARN gymnastics either (a profile would have required
   allowing the profile ARN *and* the underlying foundation-model ARNs in us-east-1/2/us-west-2).
   Rejected alternatives, receipts: Claude Sonnet 4.5 = $3/$15 per MTok **and** no In-Region
   endpoint (needs the `us.` profile) **and** the Anthropic use-case form; Meta Llama 3.3 70B and
   3.1 8B are **Legacy** — "once the Legacy period begins, new customers can't use Legacy models",
   which rules them out on a brand-new account; Cohere Command R/R+ passed EOL 2026-08-19; Titan
   Text is absent from the current regional-availability catalog.
   ⚠️ **Nova rejects `temperature: 0`** (documented range 0.00001–1) — the review phase used to send
   a literal 0. Fixed via `temperatureFor()` since 10-21, pinned by tests.
3. Credentials + env flip + 30 s smoke via `npm run smoke`. **Preferred shape: a Bedrock API key**
   (console → Bedrock → API keys → *short-term*, ≤12 h) exported as `AWS_BEARER_TOKEN_BEDROCK`.
   One value, self-expiring, Bedrock-scoped by construction, and this SDK's default chain reads it
   natively (confirmed in `@aws-sdk/core`: `signingName: "bedrock"` → that env key →
   `["httpBearerAuth"]`). `hasAwsEnvCreds()` accepts it since 10-21, so the smoke stops reporting
   GATED. Long-lived IAM access keys are the fallback; if minting temporary ones instead, hand
   **STS session** creds (`get-session-token`, ≤36 h, three vars incl. `AWS_SESSION_TOKEN`) and
   never your own key.
   Whole demo workload ≈**US$0.013** on Nova Lite ($0.06/$0.24 per MTok × ~70 calls at 1.5k in /
   400 out). Nova Pro ($0.80/$3.20) would run ≈US$0.18 if Lite's DE/FR recasts read weak — still
   noise against the $100 signup credits, and quality is the thing to optimise here, not price.
   Quota caveat, doc-verified: Bedrock throttles on **tokens/min**, and *"the quotas that apply to
   your account might be lower than the default values depending on account age"* — ~133k tokens
   issued sequentially is far under any floor, but glance at Service Quotas if a call ever 429s.
   **No hard spend cap exists** — AWS Budgets alerts are free so set one on service=Bedrock anyway,
   and short-term keys expire on their own.
Everything else is built and proxy-proven. The demo video does NOT depend on this step, **but note
there is no `.env` on disk yet at all** — `demo.sh` defaults `SALA_LLM=proxy`, so recording day
needs a `.env` written first whatever backend is used. A Bedrock-backed video is one env var away
and doubles as the AWS Builder evidence; the demo script's per-beat backend labels then read
BEDROCK instead of PROXY with no other change.

**Post-hackathon (BYOK):** the public shape is Bedrock as the demo default with proxy/echo as
bring-your-own-key options. Echo mode is already the zero-secret onboarding path and the backends
sit behind one interface, so BYOK is a README/docs framing change, not a rebuild.

## Pre-flight (repo hygiene, before going public)

- [ ] No secrets: `.env` gitignored. Re-verify `git log --all --diff-filter=A -- '*.env'` is
      empty, and grep history for key shapes.
- [ ] Piper models and `data/*.db` are gitignored and absent from history (models never
      committed; `data/sala.db*` untracked since the A2 WAL-sidecar fix).
- [ ] README status matches reality at submission time (test count, voice matrix, gating).
- [ ] `docs/a2-assets/` + `docs/a3-assets/` screenshots are honest captures (they are; the
      labeled STT double appears in no asset).
- [ ] `git log` reads as a build story (seed → A1 → security → CORS → A2 → voice → A3).
- [ ] Flip visibility to public at submission time (Dylan's action, not an agent's).

## Blocking chain + latest-safe dates

```
Dylan's AWS enablement ──→ Bedrock live smoke ──→ AWS Builder claim in form (optional branch)
Alan's cold run (README teammate guide) ──→ demo video record (DEMO-SCRIPT.md)
        ──→ edit + public YouTube/Vimeo upload ──→ form link
Dylan: product feedback markers resolved + friction-log export ──→ form paste
repo public + MIT visible ──┐
all of the above ───────────┴──→ SUBMIT before Fri 23 Oct 12:00 PT
```

Latest-safe dates (today is Tue 20 Oct):

- **Wed 21 Oct morning:** Dylan demos live for Alan on this machine (DEMO-SCRIPT runbook); Alan
  cold-runs on his own machine the same day using the README teammate guide (echo first, then
  proxy creds handed over privately).
- **Wed 21 Oct evening:** video recorded + cut (end_session latency cut around it).
- **Thu 22 Oct:** video published public; product feedback final; friction log exported; repo
  flipped public with MIT visible. One full day of slack.
- **Fri 23 Oct before 03:00 HKT / Thu 12:00 PT:** form submitted by Alan, Dylan cross-checks the
  five feedback answers and the repo URL.

The two chains are independent until the form: the video needs no AWS step, and Bedrock can go
live after the video without touching it.
