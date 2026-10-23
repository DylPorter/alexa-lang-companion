/**
 * Live proof of the spoken language switch, against a running server.
 *
 *   npx tsx scripts/language-switch-proof.ts [http://127.0.0.1:3100/mcp]
 *
 * One session, three turns: start in French, ask out loud for German the way a learner
 * would mid-conversation, then keep talking in German. Prints what came back and what the
 * server says the session covered, so the beat can be rehearsed before it is filmed and so
 * the claim in the submission ("you change language by asking") has a transcript behind it.
 * Real proxy calls, nothing mocked — including the review at the end.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.argv[2] ?? "http://127.0.0.1:3100/mcp");
interface ChatTurn {
  reply: string;
  sessionId: string;
  language: string;
  languageName: string;
  languageChanged: boolean;
  isNewSession: boolean;
}

const client = new Client({ name: "language-switch-proof", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(url));

async function turn(label: string, args: Record<string, unknown>): Promise<ChatTurn> {
  const t0 = Date.now();
  const res = await client.callTool({ name: "chat", arguments: args });
  if (res.isError) throw new Error(`chat failed: ${JSON.stringify(res.content)}`);
  const s = res.structuredContent as ChatTurn;
  console.log(
    `\n[${label}] ${((Date.now() - t0) / 1000).toFixed(1)}s · language=${s.language}` +
      `${s.languageChanged ? " (CHANGED)" : ""} · ${s.languageName}\n  ${s.reply}`,
  );
  return s;
}

console.log("=== one session, language changed by asking ===");
let sid = (await turn("open in French", {
  message: "Bonjour Sala ! Aujourd'hui je suis allé au marché.",
  targetLanguage: "fr",
})).sessionId;
sid = (await turn("reply in French", { message: "J'ai acheté des fraises et du pain.", sessionId: sid })).sessionId;
const german = await turn("ASK FOR GERMAN", {
  message: "Hmm, actually let's speak German for the rest of the evening.",
  sessionId: sid,
});
sid = german.sessionId;
const germanChanged = german.languageChanged && german.language === "de";
sid = (await turn("reply in German", { message: "Meine Freundin heißt Anna, wir kochen zusammen.", sessionId: sid })).sessionId;
// The negative, on the live path: a MENTION of a language is content, not a command. A
// session that switched because somebody said the word "Japanese" mid-sentence is the bug
// this whole feature could ship with, so it gets asserted here and not only in unit tests.
const mention = await turn("mention only", {
  message: "How do you say strawberry in Japanese? My sister is learning it.",
  sessionId: sid,
});
const mentionChanged = mention.languageChanged;
const mentionLanguage = mention.language;

// Issue #4, on the live path: the switch asked as a session's FIRST words. This is the
// shape the unit tests could not see, because the sim attaches its picker value to the
// message that opens a session — so `targetLanguage: "en"` competed with the request for
// Spanish and, while the reply text came out in Spanish, every piece of state said
// English: no pill, no picker move, English TTS voice, English transcript tags.
const opener = await turn("asked in turn one", {
  message: "Hey Sala, let's speak Spanish tonight.",
  targetLanguage: "en",
});
const openerLanded = opener.isNewSession && opener.language === "es" && opener.languageChanged;

const ended = await client.callTool({ name: "end_session", arguments: { sessionId: sid } });
const out = ended.structuredContent as { review: { summary: string }; extractionPath: string };
console.log(
  `\n[end_session] path=${out.extractionPath}\n  summary: ${out.review.summary.replace(/\s+/g, " ").trim()}`,
);

const listed = await client.callTool({ name: "list_sessions", arguments: {} });
const sessions = (listed.structuredContent as { sessions: Array<{ id: string; language: string; languages: string[] }> })
  .sessions;
const mine = sessions.find((s) => s.id === sid);
console.log(`\n[past sessions] this session is tagged: ${JSON.stringify(mine?.languages ?? ["(not found)"])}`);

const switched = sessions.filter((s) => (s.languages?.length ?? 0) > 1).length;
console.log(`[past sessions] mixed-language sessions stored: ${switched}`);

// ---- verdicts, in the shape scripts/run-qa.sh gates on (`: FAIL` on any line) ----
const checks: Array<[string, boolean]> = [
  ["spoken request changed the session", germanChanged],
  ["a switch in the first utterance lands", openerLanded],
  ["a mention of a language does not switch", !mentionChanged && mentionLanguage === "de"],
  ["the review names both languages", /french/i.test(out.review.summary) && /german/i.test(out.review.summary)],
  ["past sessions stored both languages", JSON.stringify(mine?.languages) === '["fr","de"]'],
];
let failed = 0;
for (const [label, ok] of checks) {
  console.log(`[switch] ${label}: ${ok ? "PASS" : "FAIL"}`);
  if (!ok) failed++;
}
await client.close();
if (failed) process.exitCode = 1;
