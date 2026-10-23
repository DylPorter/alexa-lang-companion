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

- **We satisfy the mandatory half outright:** a real MCP server over Streamable HTTP, running on
  infrastructure we choose — which is what the rule's "self-hosted" means — speaking protocol
  revision 2025-11-25 (the pinned SDK 1.32.1's `LATEST_PROTOCOL_VERSION`). The web sim is a genuine
  MCP client: the SDK is imported and the server is called at runtime, so the repo also satisfies
  the non-simulated reading of the track.
- **Wording decision, 2026-10-23 (Dylan):** our own copy — README, video narration, the
  architecture diagram — says **"hosted anywhere"**, not "self-hosted". Nothing in the rules
  requires the server to stay on the developer's laptop, and if Sala becomes a real product Amazon
  (or any host) can run it. "Self-hosted" would be a claim we have to walk back later. The rule's
  verbatim term appears only here and in the quote above, where we are mapping to the rule.
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
  **Plan: public at submission.** Alan (`atiyev`) needs collaborator access so he can cold-run the
  demo on his own machine (README has the teammate guide). **Checked, not assumed, 10-22 12:26:**
  `collaborators` returned only `DylPorter` and no pending invite existed — the earlier "added"
  note in this file was never true. Invitation id 338677853 sent to `atiyev` with `push`
  (`pull` is rejected on a personal private repo: 422 "Cannot assign permission of read"). He must
  accept it; the repo is still invisible to him until he does. Re-check with
  `gh api repos/DylPorter/alexa-lang-companion/invitations`.
  The repo must contain all source, assets, and instructions to be functional.
- [ ] **Product Feedback (REQUIRED)** — five questions per tool/API/SDK used: (1) which tools
  and for what; (2) what worked well; (3) what needs work; (4) onboarding zero → hello world;
  (5) would you build with these again, Yes/No + why. Owner: Dylan.
  **DRAFT v2: [PRODUCT-FEEDBACK.md](PRODUCT-FEEDBACK.md)** (voice-checked). The Bedrock enablement
  marker is resolved (10-22) and says honestly that we have not seen a live Nova reply. Before
  pasting: re-verify every claim against that day's reality, especially if Bedrock lands.
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

- [x] ~~**AWS Builder ($5k, 1 winner)**~~ **NOT CLAIMED — decision 10-22, Dylan.** — *"Any primary track project that incorporates AWS
  services (Amazon Bedrock, AgentCore, Strands SDK, Kiro Crew, SageMaker, etc.) with documented
  integrations."* Our path: `BedrockLLM` (`src/llm/bedrock.ts`), a first-class core backend using
  `@aws-sdk/client-bedrock-runtime` converse API, documented in README + SPEC.
  **⛔ GATED, and as of 10-22 the gate is an account-shape problem, not a code problem.** Two
  blockers found by actually running it: the account is an AWS Organizations member and the org's
  SCP denies `bedrock:CallWithBearerToken`, so the API-key path is unusable there at all; and with
  SigV4 working, the Free account plan answers every Nova model with a first-call `Throttling
  Exception: Too many tokens per day` because it has no paid Bedrock capacity. Resolving it needs
  (a) confirmation that management account `023439859073` belongs to Dylan and not to an employer,
  and (b) a paid-plan upgrade, which is why the org check comes first. Until a Nova reply exists the
  smoke prints the real provider error and the mini-challenge claim is **not** made. Mark it clearly
  in the form either way. Honest fallback if enablement never lands: the entry still stands on the
  Alexa+ track alone, and the enablement friction is submitted as Product Feedback regardless.
  Scoring note: "Obvious: single Bedrock call. Creative: multi-service pipeline, agentic
  architecture." Our shape (LLM backend swap with in-code validation of model output, memory
  retrieval feeding the prompt) is above the obvious bar. Write it up that way only if live.
- [ ] **Open Source ($5k, 1 winner)** — VERIFIED (via the firetv rules read): requires a **new
  additional OSS project or a contribution to an existing public repo made during the hackathon
  window (31 Aug – 23 Oct), alongside the primary submission.** MIT-licensing this repo does NOT
  qualify — the side track wants something *additional*. **Decision: skip.** Plan changes only if a
  genuine upstream PR emerges from the build (candidates so far: an SDK doc patch on
  empty-`allowedOrigins` semantics). Never fabricate a contribution.

  Re-checked against GitHub 2026-10-23 (Dylan asked whether we could enter this and whether to
  relicense Sala AGPL-3.0). What actually exists on this machine, with dates from the API:

  | repo | visibility | created | last push | licence |
  |---|---|---|---|---|
  | `DylPorter/alexa-lang-companion` (Sala, the primary submission) | PUBLIC | 2026-10-19 | 2026-10-23 | MIT |
  | `DylPorter/teledesk` | PUBLIC | 2026-05-20 | 2026-10-20 | `LICENSE` present (MIT) |
  | `DylPorter/claudish-to-english-action` | PUBLIC | 2026-08-10 | 2026-10-21 | `LICENSE` present (MIT) |
  | `DylPorter/pacl` | PUBLIC | — | 2026-08-11 | AGPL-3.0 |

  **Neither candidate is "new in the window"**: both pre-date 31 Aug. What they do have is real
  in-window work on already-public repos — teledesk has 117 commits since 31 Aug (pushed 20 Oct),
  claudish was pushed 21 Oct. So the honest reading is: the "new additional OSS project" clause is
  not met by anything I have, and the "a contribution (a branch, a fork, or a pull request) to a
  public repository" clause is arguable — the clause reads most naturally as contributing to
  somebody else's repo, and using my own pre-existing repo is the kind of stretch a judge can read
  either way. Unverified: how the judges read it. There is no licence requirement beyond "include an
  open-source license", so **relicensing Sala to AGPL-3.0 buys nothing here** — and it would be a
  real change for Alan and any downstream user, three hours before the deadline. Sala stays MIT.

  If Dylan wants the entry anyway, the strongest available filing is teledesk as the in-window
  contribution (repo URL + GitHub username + what landed and why it matters), described exactly as
  above and not as a new project. Draft text for that:

  > **What I did:** continued building `teledesk` (https://github.com/DylPorter/teledesk) through
  > the hackathon window — 117 commits since 31 Aug, most recent 20 Oct. It drives Claude Code from
  > a phone over Telegram using the plan's own auth (no API key), running as a systemd service on
  > your machine, with a session wiretap that mirrors an in-progress run into a topic as it happens.
  > **How it works:** a local bridge subscribes to the harness's own event stream and re-emits it as
  > chunked Telegram messages, so a long unattended run stays readable and interruptible from a
  > phone. **Why it matters:** it is the same problem the Alexa+ track is about — a capable model
  > with a surface you can actually reach — solved for the developer's phone instead of the
  > living room. MIT-licensed, `LICENSE` at the repo root.

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
Everything else is built and proxy-proven. The demo video does NOT depend on this step. Update
10-22: `.env` now exists on disk (mode 600, gitignored) with `SALA_LLM=proxy`, and that backend is
proven from the file alone, so recording day needs no setup on this machine. Alan's machine is the
other case: echo mode still works with no `.env` at all, and since 10-23 he is no longer limited to
it — one `GEMINI_API_KEY` or `OPENAI_API_KEY` of his own gives a real conversation with no AWS and
no credential from Dylan (README, "Cold run on a new machine"). A Bedrock-backed video would still be
one env var away, but with Builder not claimed there is no reason to touch it.

**BYOK — shipped 10-23.** The paragraph that used to sit here planned it as post-hackathon docs
framing ("Bedrock as the demo default with proxy/echo as bring-your-own-key options"), which was
really a euphemism for "a teammate cannot run this without Dylan's gateway". Two real lanes now
exist behind the same one-method interface: `OpenAILLM` (any OpenAI-compatible
`/chat/completions` server) and `GeminiLLM` (Google `v1beta …:generateContent`). They rank below
Bedrock and the proxy in auto-detection so a stray key in a shared shell cannot silently change
which provider a recorded demo used; `SALA_LLM=openai|gemini` forces them anywhere.
**Status, same rule as the Bedrock paragraph above:** 28 offline tests with `fetch` stubbed, wired
into `/health`, `demo.sh`, `run-qa.sh` and `npm run smoke`, and **no live provider reply observed
yet** — neither author holds a Gemini or OpenAI key on this machine, so whoever's key runs it
produces the first evidence. Echo mode remains the zero-secret onboarding path.

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
(dropped 10-22) Dylan's AWS enablement ──→ Bedrock live smoke ──→ AWS Builder claim
Alan's cold run (README teammate guide) ──→ demo video record (DEMO-SCRIPT.md)
        ──→ edit + public YouTube/Vimeo upload ──→ form link
Dylan: product feedback markers resolved + friction-log export ──→ form paste
repo public + MIT visible ──┐
all of the above ───────────┴──→ SUBMIT before Fri 23 Oct 12:00 PT
```

Latest-safe dates (today is Wed 22 Oct, and the film session moved to Thursday with Alan):

- **Wed 22 Oct (today):** Alan accepts the invite, clones, cold-runs in echo mode on his own
  machine (zero secrets, that is the documented path). Dylan finalises Product Feedback, the friction
  log export and the track/mini-challenge answers. Backend for recording is the proxy, already proven
  from the gitignored `.env` (real recast, `memoryReferenced: true`, `extractionPath: llm`).
- **Thu 23 Oct:** Dylan + Alan meet and film (device view, Beat 4b inspector cut, `end_session`
  cut-around). Edit and upload the video public on YouTube/Vimeo the same day, because the form takes
  a *public* link and an unlisted upload is not a submission.
- **Thu 23 Oct / Fri 24 Oct before 03:00 HKT (Fri 12:00 PT):** flip the repo public with MIT visible,
  Alan submits the form, Dylan cross-checks the five feedback answers, the friction entries and the
  repo URL. Slack is roughly 24-30 hours, not a day, so anything that can be finished today should be.

The two chains are independent until the form: the video needs no AWS step, and Bedrock can go
live after the video without touching it.
