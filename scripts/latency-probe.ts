/**
 * Latency probe for the 40s dead air on camera (2026-10-23).
 *
 * review-raw-blocks.ts proved the cause: with the real review prompt the gateway
 * returns ~2.0k `thinking` tokens BEFORE any `text`, and max_tokens bills both.
 * This script answers the follow-up questions with measurements instead of guesses:
 *
 *   npx tsx scripts/latency-probe.ts shapes [reps]   which request shape actually
 *       stops the reasoning? Prints per shape: HTTP status, stop_reason, block
 *       types+lengths, wall clock. One line each, nothing inferred.
 *   npx tsx scripts/latency-probe.ts bench [reps]    before/after medians through
 *       the REAL ProxyLLM code path (so what is measured is what the server does),
 *       for both phases: review and chat.
 *   npx tsx scripts/latency-probe.ts stream          does the gateway honour
 *       stream:true on /v1/messages, and are thinking_delta / text_delta
 *       distinguishable? (finding only — no streaming implemented)
 *   npx tsx scripts/latency-probe.ts models          what model ids does the
 *       gateway list/accept? (GET /v1/models + one cheap probe per candidate)
 *
 * Options: --model=<id> overrides the phase model (sets SALA_REVIEW_MODEL +
 * SALA_CHAT_MODEL before constructing the backend). --max-tokens=N for shapes.
 *
 * NEVER prints secret values or response bodies — status codes, block types,
 * lengths and token counts only. Proxy error bodies can echo request headers, so
 * they are truncated and are for non-auth 4xx shapes only.
 */
import "dotenv/config";
import { chatSystemPrompt, reviewSystemPrompt } from "../src/persona/prompts.js";
import { ESL_ENGLISH_FIXTURE } from "../tests/fixtures/conversations.js";
import { ProxyLLM } from "../src/llm/proxy.js";
import { maxTokensFor } from "../src/llm/types.js";

const argv = process.argv.slice(2);
const mode = argv.find((a) => !a.startsWith("--")) ?? "shapes";
const repsOf = () => Number(argv.find((a) => /^\d+$/.test(a)) ?? (mode === "shapes" ? 1 : 3));
const flag = (name: string): string | undefined =>
  argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const base = (process.env.ANTHROPIC_BASE_URL ?? "").replace(/\/+$/, "");
const key = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || "";
if (!base || !key) throw new Error("ANTHROPIC_BASE_URL / token missing from .env");
const defaultModel = process.env.SALA_MODEL || process.env.ANTHROPIC_MODEL || "qwen3.8-flash";

const cfg = { targetLanguage: "en", nativeLanguage: "uk" };
const transcript = ESL_ENGLISH_FIXTURE.map((t) =>
  `${t.role === "user" ? "USER" : "SALA"}: ${t.content}`,
).join("\n");
const REVIEW_SYSTEM = reviewSystemPrompt(cfg);
// A realistic mid-conversation chat turn: the same prompt shape tools.ts builds,
// with the fixture as history and a fresh learner message on the end.
const CHAT_SYSTEM = chatSystemPrompt(cfg, []);
const CHAT_MESSAGES = [
  ...ESL_ENGLISH_FIXTURE.slice(0, 6),
  { role: "user" as const, content: "Yesterday I go to climbing wall and it was very difficult." },
];

type Shape = { name: string; extra?: Record<string, unknown>; maxTokens?: number; model?: string };

/** Every candidate lever for killing the thinking block, tested, not assumed. */
const SHAPES: Shape[] = [
  { name: "baseline (no thinking field)" },
  { name: "thinking:{disabled}", extra: { thinking: { type: "disabled" } } },
  { name: "thinking:{enabled,budget 1024}", extra: { thinking: { type: "enabled", budget_tokens: 1024 } } },
  { name: "thinking:{enabled,budget 512}", extra: { thinking: { type: "enabled", budget_tokens: 512 } } },
  { name: "enable_thinking:false (top level)", extra: { enable_thinking: false } },
  { name: "chat_template_kwargs:{enable_thinking:false}", extra: { chat_template_kwargs: { enable_thinking: false } } },
  { name: "thinking:{disabled} + max_tokens 1024", extra: { thinking: { type: "disabled" } }, maxTokens: 1024 },
  { name: "reduced-output prompt, thinking ON", maxTokens: 8192 },
  { name: "reduced-output prompt + thinking disabled", extra: { thinking: { type: "disabled" } }, maxTokens: 1500 },
];

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (n: number) => `${n.toFixed(1)}s`;

async function callOnce(body: Record<string, unknown>): Promise<Parsed> {
  const t0 = Date.now();
  let status = 0;
  let statusText = "";
  let parsed: Parsed = {};
  let errText = "";
  try {
    const resp = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": key,
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    status = resp.status;
    statusText = resp.statusText;
    const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    parsed = json as Parsed;
    if (!resp.ok) errText = JSON.stringify(parsed).slice(0, 200);
  } catch (e) {
    errText = String(e).slice(0, 160);
  }
  return { ...parsed, _ms: Date.now() - t0, _status: status, _statusText: statusText, _err: errText };
}

interface Parsed {
  stop_reason?: string;
  usage?: Record<string, number>;
  content?: { type?: string; text?: string; thinking?: string }[];
  error?: unknown;
  _ms?: number;
  _status?: number;
  _statusText?: string;
  _err?: string;
}

/** `thinking:2043 text:1712` — block types and lengths, never contents. */
function blocksOf(p: Parsed): string {
  return (
    JSON.stringify(
      (p.content ?? []).map((b) =>
        `${b.type}:${((b.text ?? "") + (b.thinking ?? "")).length}`,
      ),
    ) ?? "[]"
  );
}
const usageOf = (p: Parsed) =>
  `in=${p.usage?.input_tokens ?? "?"} out=${p.usage?.output_tokens ?? "?"}`;

/**
 * Local parse check rather than importing extractJsonObject from
 * src/review/extract.ts — that file is under concurrent edit right now, and this
 * script only needs the "is it JSON" verdict, not the production parser.
 */
function extractJsonObjectSafe(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    return obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function reviewBody(shape: Shape, maxTokensDefault: number): Record<string, unknown> {
  const compact = shape.name.startsWith("reduced-output prompt");
  const system = compact ? COMPACT_REVIEW_PROMPT : REVIEW_SYSTEM;
  return {
    model: shape.model ?? defaultModel,
    max_tokens: shape.maxTokens ?? maxTokensDefault,
    temperature: 0,
    system,
    messages: [{ role: "user", content: `TRANSCRIPT:\n${transcript}` }],
    ...(shape.extra ?? {}),
  };
}

/** The payload lever: same integrity rule, much smaller requested output. */
const COMPACT_REVIEW_PROMPT = reviewSystemPrompt(cfg).replace(
  /HARD RULES[\s\S]*$/,
  `HARD RULES
- OUTPUT SHAPE (hard caps — exceeding them wastes the token budget): at most 5 vocabulary items,
  at most 2 grammar points, each "note"/"explanation" ONE short sentence (max 20 words),
  "summary" under 140 characters. No preamble, no code fence, JSON only.
- 4-5 vocabulary items: words the learner used or struggled with. Every "example" must be copied
  WORD-FOR-WORD from a learner (USER) turn in the transcript — no paraphrasing, no invented
  sentences. This rule is absolute: an example that is not the learner's own verbatim sentence is
  thrown away by the validator, so inventing one loses the item.
- 1-2 grammar points, each tied to a mistake the learner ACTUALLY made in this transcript (common
  classes: articles, tense agreement, prepositions, word order). If the learner made no observable
  mistakes, return "grammar": [] — never fabricate teaching points.
- The summary must describe only topics present in the transcript.`,
);

async function modeShapes(): Promise<void> {
  const reps = repsOf();
  const maxTokDefault = Number(flag("max-tokens") ?? maxTokensFor("review"));
  console.log(`# shapes · model=${defaultModel} · review phase · ${reps} rep(s) · max_tokens=${maxTokDefault}\n`);
  for (const shape of SHAPES) {
    const runs: number[] = [];
    let withText = 0;
    let parsedJson = 0;
    for (let i = 0; i < reps; i++) {
      const p = await callOnce(reviewBody(shape, maxTokDefault));
      runs.push(p._ms!);
      const text = (p.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      if (text.trim()) withText++;
      // Report the parse verdict only, never the model's text.
      const obj = extractJsonObjectSafe(text);
      if (obj) parsedJson++;
      console.log(
        `  ${shape.name.padEnd(46)} rep${i + 1} HTTP=${p._status ?? "ERR"} ${p._statusText ?? ""} ` +
          `${fmt(p._ms! / 1000).padStart(7)} stop=${p.stop_reason ?? "-"} blocks=${blocksOf(p)} ${usageOf(p)} ` +
          `json=${obj ? "PARSES" : text.trim() ? "UNPARSEABLE" : "EMPTY"}` +
          (p._err ? ` err=${p._err}` : ""),
      );
    }
    console.log(
      `  ${shape.name.padEnd(46)} MEDIAN ${fmt(median(runs) / 1000)}  text=${withText}/${reps} parses=${parsedJson}/${reps}\n`,
    );
  }
}

async function modeBench(): Promise<void> {
  const reps = repsOf();
  const model = flag("model");
  if (model) {
    process.env.SALA_REVIEW_MODEL = model;
    process.env.SALA_CHAT_MODEL = model;
    process.env.SALA_MODEL = model;
  }
  const llm = new ProxyLLM();
  console.log(`# bench · real ProxyLLM code path · model=${model ?? defaultModel} · ${reps} reps\n`);

  for (const phase of ["review", "chat"] as const) {
    const runs: { secs: number; chars: number; empty: boolean }[] = [];
    for (let i = 0; i < reps; i++) {
      const t0 = Date.now();
      let out = "";
      try {
        out = await llm.invoke(
          phase,
          phase === "review" ? REVIEW_SYSTEM : CHAT_SYSTEM,
          phase === "review"
            ? [{ role: "user", content: `TRANSCRIPT:\n${transcript}` }]
            : CHAT_MESSAGES,
        );
      } catch (e) {
        console.log(`  [${phase}] rep${i + 1} ERROR ${String(e).slice(0, 140)}`);
      }
      runs.push({ secs: (Date.now() - t0) / 1000, chars: out.length, empty: !out.trim() });
      console.log(
        `  [${phase}] rep${i + 1} ${fmt(runs[runs.length - 1].secs)} chars=${runs[runs.length - 1].chars}` +
          (runs[runs.length - 1].empty ? " EMPTY" : ""),
      );
    }
    const ok = runs.filter((r) => !r.empty);
    console.log(
      `  [${phase}] MEDIAN ${fmt(median(runs.map((r) => r.secs)))} over ${runs.length} ` +
        `(empties=${runs.length - ok.length})\n`,
    );
  }
}

async function modeStream(): Promise<void> {
  console.log(`# stream probe · stream:true on /v1/messages, review prompt, thinking disabled\n`);
  for (const shape of [
    { name: "stream baseline", extra: {} },
    { name: "stream + thinking disabled", extra: { thinking: { type: "disabled" } } },
  ]) {
    const t0 = Date.now();
    let firstByte = -1;
    let sawTextDelta = false;
    let sawThinkingDelta = false;
    let types = new Set<string>();
    let status = 0;
    let errText = "";
    try {
      const resp = await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": key,
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: defaultModel,
          max_tokens: maxTokensFor("review"),
          temperature: 0,
          stream: true,
          system: REVIEW_SYSTEM,
          messages: [{ role: "user", content: `TRANSCRIPT:\n${transcript}` }],
          ...shape.extra,
        }),
        signal: AbortSignal.timeout(180_000),
      });
      status = resp.status;
      if (!resp.ok) {
        errText = (await resp.text()).slice(0, 200);
      } else if (resp.body) {
        const reader = resp.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (firstByte < 0) firstByte = Date.now() - t0;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const ev = JSON.parse(payload) as { type?: string; delta?: { type?: string } };
              if (ev.type) types.add(ev.type);
              if (ev.delta?.type === "text_delta") sawTextDelta = true;
              if (ev.delta?.type === "thinking_delta") sawThinkingDelta = true;
            } catch {
              /* non-JSON keepalive line */
            }
          }
        }
      }
    } catch (e) {
      errText = String(e).slice(0, 200);
    }
    console.log(
      `  ${shape.name.padEnd(30)} HTTP=${status || "ERR"} total=${fmt((Date.now() - t0) / 1000)} ` +
        `firstByte=${firstByte < 0 ? "-" : `${(firstByte / 1000).toFixed(1)}s`} ` +
        `text_delta=${sawTextDelta} thinking_delta=${sawThinkingDelta} eventTypes=${[...types].join(",") || "-"}` +
        (errText ? ` err=${errText}` : ""),
    );
  }
}

async function modeModels(): Promise<void> {
  console.log(`# models · what does the gateway expose / accept?\n`);
  for (const path of ["/v1/models", "/models"]) {
    try {
      const r = await fetch(`${base}${path}`, {
        headers: { "x-api-key": key, authorization: `Bearer ${key}`, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(15_000),
      });
      const txt = await r.text();
      console.log(`  GET ${path} → HTTP=${r.status} len=${txt.length} ${r.ok ? txt.slice(0, 400) : txt.slice(0, 120)}`);
    } catch (e) {
      console.log(`  GET ${path} → ${String(e).slice(0, 100)}`);
    }
  }
  // One-token probe per candidate id: does the gateway 400 unknown models, and
  // does a no-reasoning variant name exist? Content is irrelevant here — status is.
  for (const m of [
    defaultModel,
    `${defaultModel}-nothink`,
    `${defaultModel}-instruct`,
    "qwen3-30b-instruct",
    "qwen3.8-flash-max",
  ]) {
    const p = await callOnce({
      model: m,
      max_tokens: 16,
      temperature: 0,
      system: "Reply with the single word OK.",
      messages: [{ role: "user", content: "ping" }],
    });
    console.log(
      `  probe model=${m.padEnd(26)} HTTP=${p._status ?? "ERR"} ${fmt((p._ms ?? 0) / 1000)} ` +
        `stop=${p.stop_reason ?? "-"} blocks=${blocksOf(p)}${p._err ? ` err=${p._err}` : ""}`,
    );
  }
}

console.log(`# sala latency-probe · base=${base.replace(/^https?:\/\/[^/]+/, (h) => h.replace(/[^/]*$/, "<redacted>"))} · mode=${mode}\n`);
switch (mode) {
  case "shapes":
    await modeShapes();
    break;
  case "bench":
    await modeBench();
    break;
  case "stream":
    await modeStream();
    break;
  case "models":
    await modeModels();
    break;
  default:
    console.log(`unknown mode "${mode}" — expected shapes | bench | stream | models`);
    process.exit(1);
}
