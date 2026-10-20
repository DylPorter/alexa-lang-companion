# Product Feedback (REQUIRED form section), DRAFT v1, 2026-10-20

Owner: Dylan. Status: draft for the Devpost form's Product Feedback requirement. Five
questions per tool, per the rules. Resolve the one `[UPDATE-AFTER-ENABLEMENT]` marker and
re-verify every claim before pasting into the form.

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

**What needs work.** Reliability and signals. Three times across the build the proxy returned
HTTP 200 with empty content, including once on both attempts of a single chat turn, which is
why our server retries once and then says "I lost my words" instead of inventing a reply. A 200
with empty content should be an error status. Review extraction runs 28 to 41 s against it with
no streaming or progress on the tool call, which is the demo's only dead air. And the ambient
environment exports `ANTHROPIC_API_KEY` as an empty string next to a valid
`ANTHROPIC_AUTH_TOKEN`, which traps every nullish-coalescing fallback chain. Select the first
non-empty value, or do not export empty keys.

**Zero to hello world.** One environment variable.

**Build again?** Yes. It is the reason a solo dev could build and demo this in a week.

## Amazon Bedrock (@aws-sdk/client-bedrock-runtime)

**Which tools, for what.** The first-class production LLM backend (`BedrockLLM`, converse API,
default model `anthropic.claude-sonnet-4-5-20250929-v1:0`) and our AWS Builder mini-challenge
evidence.

**What worked well.** So far, the shape of it. The typed converse client compiles cleanly
against our one-method LLM interface, and the selection chain (explicit `SALA_LLM`, else AWS
creds, else proxy, else echo) means the same server binary runs offline in tests, on the proxy
in dev, and on Bedrock in production with no code change.

**What needs work.** [UPDATE-AFTER-ENABLEMENT: fill from the live smoke. Candidate items to
confirm or cut: model access enablement latency in the console, region and model-id defaults
for first-time users, and whether converse stream errors surface with enough context to retry
safely.] The honest current-state sentence for the form: the integration is complete in code
and gated in practice, because IAM user creation and model access are human steps we have not
run yet. Our smoke prints GATED rather than FAILED without creds, on purpose.

**Zero to hello world.** Blocked on the enablement step above. Our internal checklist estimates
30 minutes including the first smoke.

**Build again?** Yes, pending the live check. Nothing in the SDK has fought us yet.

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
