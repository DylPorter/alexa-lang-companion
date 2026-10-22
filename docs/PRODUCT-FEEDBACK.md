# Product Feedback (REQUIRED form section), DRAFT v2, 2026-10-22

Owner: Dylan. Status: ready for the Devpost form's Product Feedback requirement. Five questions
per tool, per the rules. The Bedrock enablement marker is resolved as of 10-22 and states plainly
that we have not yet seen a live Nova reply, so re-read that section against reality on submission
day and cut anything that has since become false rather than softening it.

Project: Sala, an Alexa+ companion MCP server (Alexa+ track). Everything below was hit during
this build, between 15 and 20 Oct 2026. The matching friction log entries (task, steps,
expected vs actual, severity, workaround, suggestion) live in our build log and will ship
alongside the submission.

## @modelcontextprotocol/sdk (TypeScript, pinned 1.32.1)

**Which tools, for what.** The entire product surface. Server side: `McpServer` with
`registerTool` and zod input plus output schemas, `StreamableHTTPServerTransport` in stateless
mode, DNS-rebinding protection. Client side: the web sim connects as a real MCP client with
`Client` and `StreamableHTTPClientTransport`, including a fetch tap that renders live JSON-RPC
for the judges.

**What worked well.** Typed tool registration with output schemas means every success arrives
as `structuredContent` with zero extra work, and the sim's TypeScript compiles against the same
shapes the server declares. Stateless mode fit our memory story perfectly: all durable state
lives in SQLite, so a fresh `McpServer` per POST loses nothing. The protocol-level integration
test (real SDK client against the real server over HTTP) passed on the first run.

**What needs work.** Four things, all documented in our friction log. One: `allowedOrigins: []`
means "no origin check", not "block all", because validation only runs when the list is
non-empty. The inverse reading is the natural one for a security allowlist, and the docblock
should say so in one line. Two: the client issues the spec-optional GET listen on every connect
even against a stateless server, which answers 405, so every page load logs a console error and
our judges-facing inspector shows a row we have to explain. A `disableSseListen` option or a
stateless signal in the initialize result would remove it. Three: the SDK implements protocol
2025-11-25 while the spec is at 2026-07-28. That is fine for this hackathon (2025-11-25 is the
stated minimum and the version Alexa+ for Builders supports) but the npm landing page should
state the implemented revision. Four: the default client request timeout is 60 s, and one
`end_session` call over a congested proxy backend took longer than that. The server was still
working. We had to pass a per-call timeout. Tool calls that wrap an LLM pass need either a
generous default or a progress signal.

**Zero to hello world.** Fast. The TypeScript README examples got a stdio server running in
minutes. The Streamable HTTP stateless pattern took longer to find because most examples lead
with stdio, and stateless is exactly what a hosted add-on wants.

**Build again?** Yes. It is the reason this project exists in this shape at all. The four items
above are documentation and option gaps, not design problems.

## Web Speech API (SpeechRecognition + speechSynthesis)

**Which tools, for what.** Voice mode in the web sim. `SpeechRecognition` for learner speech
with interim transcripts, `speechSynthesis` as the first-choice TTS backend when the browser
has voices.

**What worked well.** Feature detection and interim results are pleasant to build against, and
the API's event model mapped cleanly onto a half-duplex turn-taking state machine. On browsers
that ship it (Chrome and Edge on macOS and Windows) the whole voice loop worked with zero
setup.

**What needs work.** Platform honesty. On Linux, Chromium exposes `speechSynthesis` with zero
voices even when speech-dispatcher is healthy, so feature detection passes and speech silently
never happens. We shipped a local neural TTS fallback and a UI label that names the real
backend. Headless Chromium can arm recognition but can never hear anything, and there is no
fake-audio flag for speech input the way there is for camera and mic, which makes automated
voice QA impossible without a labeled test double. Firefox and Safari lack recognition
entirely, so the same page degrades to text there.

**Zero to hello world.** Minutes on a supported browser, using the MDN examples.

**Build again?** Yes, with the fallback stack we built. The API is right. The cross-platform
contract is not.

## Piper TTS (piper-tts, local neural voices)

**Which tools, for what.** The TTS fallback for machines whose browser exposes no voices, which
on Linux is every machine. A loopback-only HTTP wrapper calls the piper CLI per utterance and
streams WAV back to the same `speak()` interface the browser path uses.

**What worked well.** Install is one venv and one pip package. Synthesis of a full reply takes
1 to 3 s on CPU, and the medium voices for en, fr and de sound natural enough that our QA doc
could label them honestly instead of apologizing. German voice support was one model download
away.

**What needs work.** Distribution. Each voice is two files (model plus JSON sidecar) at about
63 MB from a Hugging Face repo with a four-level path shape you have to derive by hand. We
nearly shipped a wrong download glob in our own docs before checking the URL against a
successful fetch. A `piper download-voice en_US lessac medium` helper would remove the whole
class of mistakes. There is also no bundled server, so every integrator writes the same small
HTTP wrapper.

**Zero to hello world.** About ten minutes including the first model download. The CLI reads
stdin and writes WAV, which is exactly the shape a wrapper wants.

**Build again?** Yes. It turned a silent Linux demo into a spoken one.

## better-sqlite3 + SQLite FTS5

**Which tools, for what.** The whole memory layer: activities, conversations, session
summaries, review items, and recall via an external-content FTS5 index with bm25 plus recency
ranking.

**What worked well.** The synchronous API is a perfect fit for request-scoped stateless
handlers: no connection pool, no await between a tool call and its memory read. Accent-insensitive
matching via `unicode61 remove_diacritics 2` made French recall behave with one tokenizer
option. The single DB file as the user's entire account is the product's portability pitch, and
SQLite made that literal.

**What needs work.** Two error-shape gaps. `MATCH` rejects table aliases with "no such column"
pointing at the alias, when the real constraint is that the left side must be the FTS table
name. And `remove_diacritics 2` folds accents but not ligatures, so "soeur" does not match
"sœur", which matters for exactly the language this product teaches. A tokenizer option for
ligature expansion (œ to oe, æ to ae, ß to ss) would fix a whole class of French and German
misses.

**Zero to hello world.** Minutes. The FTS5 docs are deep and readable.

**Build again?** Yes, without hesitation.

## Vite + React (sim SPA, vitest host)

**Which tools, for what.** The single-page companion UI, its dev server, and the component and
reducer tests under vitest with jsdom.

**What worked well.** `strictPort` turned port collisions into loud failures instead of shadow
servers, which mattered on a shared dev machine. The React component tests for the review panel
and the pure conversation reducer kept the sim honest: every rendered example string comes from
server `structuredContent`, never from client-side invention.

**What needs work.** HMR and module-level media do not mix. Editing sim source mid-utterance
fast-refreshes the component state but orphans the playing `<audio>` element and its `onended`
handler, so the voice machine sticks in "speaking" until a full reload. Dev-only, but it costs
a confused debug cycle and looks like a state machine bug. An `import.meta.hot.dispose` guard
pattern in the docs would save people. Also: runtime endpoint configuration goes through
`import.meta.env`, which is transform-time, so a demo script that changes the server port must
export the variable before vite starts. Ours does now, and the README says so.

**Zero to hello world.** Trivial. `npm create vite` plus one proxy config line.

**Build again?** Yes.

## qwen proxy as an Anthropic-compatible dev backend (ANTHROPIC_BASE_URL)

**Which tools, for what.** The development and demo LLM. Our `ProxyLLM` speaks
`/v1/messages` against `ANTHROPIC_BASE_URL`, which let the whole project develop against a
Claude-compatible endpoint with no Anthropic account in the loop.

**What worked well.** Drop-in compatibility. One small client class, bearer plus x-api-key both
sent because proxies read one or the other, and every persona and review prompt behaved the
same as it does against other Anthropic-compatible targets.

**What needs work.** Two real gaps, and one accusation we now know was ours, not the proxy's.

The accusation first, because it is the useful part. For days this endpoint looked like it was
returning HTTP 200 with empty content, including once on both attempts of a single chat turn. On
2026-10-22 we finally measured the raw response instead of our client's view of it: `stop_reason`
was `max_tokens`, `output_tokens` had hit the cap exactly, and `content` contained a single
`thinking` block and no `text` block. The model had spent the entire budget reasoning and simply
had not started answering. Our client filtered `content` to `type === "text"` and joined it, so a
truncation looked identical to silence. So: **the reasoning block is billed against `max_tokens`
before any text is produced, and nothing in the compatibility layer says that in one place.** Our
review pass was capped at 2048; the same call needs about 2.0k of thinking plus 1.7k of text, so
it was being cut on the finish line, and it cut silently. Anyone porting an agent to a
reasoning-capable model through an Anthropic-compatible endpoint should expect their tool
extraction to come back "empty" until they give the budget real headroom.

What the proxy still owes: a response with no `text` block should not be an undifferentiated 200.
Either make truncation an error status, or say in the docs that `stop_reason: max_tokens` with a
thinking-only `content` is the signal. We now log the stop reason and block shapes ourselves when
text is empty, and that one line turned a two-day mystery into a one-line fix. Second real gap:
review extraction runs 28 to 41 s with no streaming or progress on the tool call, which is the
demo's only dead air. Third, unchanged: the ambient environment exports `ANTHROPIC_API_KEY` as an
empty string next to a valid `ANTHROPIC_AUTH_TOKEN`, which traps every nullish-coalescing fallback
chain. Select the first non-empty value, or do not export empty keys.

**Zero to hello world.** One environment variable.

**Build again?** Yes. It is the reason a solo dev could build and demo this in a week.

## Amazon Bedrock (@aws-sdk/client-bedrock-runtime)

**Which tools, for what.** The first-class production LLM backend (`BedrockLLM`, converse API,
default model `amazon.nova-lite-v1:0`) and our AWS Builder mini-challenge evidence.

**What worked well.** So far, the shape of it. The typed converse client compiles cleanly
against our one-method LLM interface, and the selection chain (explicit `SALA_LLM`, else AWS
creds, else proxy, else echo) means the same server binary runs offline in tests, on the proxy
in dev, and on Bedrock in production with no code change.

**What needs work.** Four things came out of picking the model, and all four are documentation
problems rather than SDK problems.

First, the model cards contradict themselves. The Claude Sonnet 4.5 card states "In-Region
endpoint URL: N/A" in its Programmatic Access table and then uses the bare
`anthropic.claude-sonnet-4-5-20250929-v1:0` id in its own sample code for us-east-1. A first-time
reader copies the sample and gets a confusing failure. The availability table is the part to
trust, and the docs do not say so.

Second, region and lifecycle support is scattered enough that we nearly built on a model our
account cannot call. Meta Llama 3.3 70B is still listed in the catalog and priced normally, but
the model-lifecycle page marks it Legacy with "once the Legacy period begins, new customers can't
use Legacy models". Nothing in the catalog row or the model card says that. We had chosen Llama for
the multilingual grammar work before we found the sentence, and Cohere Command R had already passed
EOL. A "you cannot adopt this with a new account" flag on the catalog row would have saved that
entire detour.

Third, Converse sells one uniform request shape but does not document per-provider parameter
limits with it. The Nova request schema says temperature is valid from 0.00001 to 1, which means
`temperature: 0`, the obvious choice for a deterministic JSON extraction call, is rejected. That
constraint lives in a different doc tree from the Converse API reference, and the Converse page
lists no per-model parameter ranges at all. We had to find it by reading the Nova schema page.

Fourth, the API key documentation names boto3 as the thing that reads `AWS_BEARER_TOKEN_BEDROCK`.
We checked the installed JS SDK instead of assuming and it does work, the auth-scheme resolver maps
`signingName: "bedrock"` to that variable and selects bearer auth automatically. Good behaviour,
undocumented. Worth stating that all SDKs read it.

The cheap models also have no structured output. `outputConfig.textFormat` is documented, but the
Nova and Llama cards show Structured Outputs unsupported, so a JSON-extraction call has to be
validated in application code. Our extractor re-sources every proposed example verbatim from the
transcript and drops anything invented, then falls back to the deterministic heuristic, so this
cost us nothing. Flagging it because the next person building a JSON-extracting agent on a cheap
model will not have that fallback pre-built, and the catalog gives no way to filter for it.

Fifth, and this is the one that cost us the session. We never got a paid Bedrock inference, so
what follows is what the enablement path actually feels like, not what a working call feels like.
The API key route failed on an AWS Organizations member account because the organization's service
control policy denies `bedrock:CallWithBearerToken`, and the api-keys doc does not mention SCPs or
that action anywhere, so the only way to discover it is to try. The error message itself was good
there, naming the action, the resource and the exact SCP ARN. Then the long-term key silently
created an IAM user with no cleanup pointer in the UI. Switching to SigV4 authentication passed
first time, and every Nova model returned `ThrottlingException: Too many tokens per day` on the
first call the account had ever made, which is not throttling, it is the Free account plan having
no paid Bedrock capacity, and the word "day" sent us checking regions, clock skew and token counts
before we read the plan rules. The retry-safety answer is therefore split. Authorization errors are
actionable. Authentication and quota errors are confidently wrong, and a brand-new account hits both
before it hits anything useful.

Honest current state for the form: the integration is complete in code, pinned by tests, and
documented, and we have not yet seen a live Nova reply. DE and FR grammar quality on Nova Lite is
therefore still unverified by us, and we are not going to describe output we have not read. Our
smoke prints GATED rather than FAILED when credentials are absent, and now prints the real provider
error rather than `undefined` when they are present but blocked, which is exactly what caught this.

**Zero to hello world.** Model selection took longest and it was documentation work, not setup. The
setup itself is small for a standalone account with a payment method, and it is invisible for an
account that is an Organizations member on the Free plan, because nothing tells you either fact up
front. Our internal checklist estimated 30 minutes including the first smoke, and the honest number
for this account is still open.

**Build again?** Yes. Nothing in the SDK has fought us, and the converse client is the least
surprising part of the whole stack. The account-plan and organizations layer is what we would read
first next time.

## Devpost and the Alexa+ developer docs

**Which tools, for what.** Rules compliance (track text, submission pieces, mini-challenges)
and the Alexa+ MCP Toolkit overview, which decided our architecture.

**What worked well.** The MCP Toolkit overview page says the load-bearing facts in plain
sentences: Alexa+ acts as the MCP client, Alexa+ handles natural language understanding and
response generation and UI rendering, and Alexa+ for Builders supports the 2025-11-25 spec
version. Those three lines are why a text-only MCP server is the correct integration surface
and why our sim's voice layer is an honest simulation of the device side. The docs also publish
an llms.txt index, which made verifying those quotes against the source fast and exact. The
rules page states the Alexa+ track's simulation option ("simulate the Alexa+ experience in a
web app using your own agentic tools") and the private-repo collaborator list without
ambiguity.

**What needs work.** The sanctioned-simulation sentence lives on the hackathon resources page
rather than in the rules text itself, so teams cross-referencing the rules alone may miss that
their web app demo is explicitly allowed. One cross-link from the rules' Alexa+ track bullet to
the resources page would close that. Separately, the Local Inspector and Web Simulator that
Amazon ships under the Category SDK docs deserve a pointer from the hackathon page, so teams
know the official tooling exists even when the sanctioned path is their own simulation.

**Zero to hello world.** The toolkit overview plus one MCP SDK quickstart was enough to have a
compliant server shape on day one.

**Build again?** Yes. The docs earned their keep.
