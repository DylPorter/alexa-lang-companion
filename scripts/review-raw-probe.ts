/**
 * Why does the LLM review pass sometimes come back unparseable? This calls the proxy
 * backend directly with the real review prompt and dumps the RAW text, so we can see
 * whether it is (a) empty content (the proxy's known 200-with-no-body bug), (b) prose
 * instead of JSON, or (c) a truncated JSON body — which maxTokensFor("review")=2048
 * would cause, and which no amount of retrying fixes.
 *
 *   npx tsx scripts/review-raw-probe.ts [reps]
 * Prints only lengths, the tail 120 chars, and a parse verdict — never the whole reply.
 */
import { ProxyLLM } from "../src/llm/proxy.js";
import { reviewSystemPrompt } from "../src/persona/prompts.js";
import { extractJsonObject } from "../src/review/extract.js";
import { ESL_ENGLISH_FIXTURE } from "../tests/fixtures/conversations.js";

const reps = Number(process.argv[2] ?? 2);
const llm = new ProxyLLM();
const cfg = { targetLanguage: "en", nativeLanguage: "uk" };
const transcriptText = ESL_ENGLISH_FIXTURE.map((t) => `${t.role === "user" ? "USER" : "SALA"}: ${t.content}`).join("\n");

for (let i = 1; i <= reps; i++) {
  const t0 = Date.now();
  let raw = "";
  let err = "";
  try {
    raw = await llm.invoke("review", reviewSystemPrompt(cfg), [{ role: "user", content: `TRANSCRIPT:\n${transcriptText}` }]);
  } catch (e) {
    err = String(e).slice(0, 160);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  let braces = 0;
  for (const ch of raw) {
    if (ch === "{") braces++;
    else if (ch === "}") braces--;
  }
  const verdict = err ? `ERR=${err}` : extractJsonObject(raw) ? "PARSES" : raw.trim() ? "UNPARSEABLE" : "EMPTY";
  console.log(
    `#${i} ${secs}s len=${raw.length} bracesNet=${braces} ${verdict} tail=${JSON.stringify(raw.slice(-90))}`,
  );
}
