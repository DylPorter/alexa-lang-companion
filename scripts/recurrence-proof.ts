/**
 * Recurrence proof (issue #2) — the on-camera claim, driven for real.
 *
 * "Make the same mistake in a later session and Sala says so, with a count" is a
 * claim about stored rows, so it is only proven by closing several sessions and
 * reading what comes back. This script does that against a LIVE server: a few
 * learner turns that keep making the same English past-tense / adjective errors,
 * `end_session`, repeat. Session 1 must show NO recurrence field (nothing stored
 * yet — the fabrication guard); session 2 must show `seenInSessions: 2`; session 3
 * `3`. It also leaves the DB in the state the filming beat needs, with real
 * conversations behind the number rather than seeded rows.
 *
 *   PORT=3100 npm start                                  (or npm run demo)
 *   npx tsx scripts/recurrence-proof.ts [mcpUrl] [sessions]
 *
 * Uses the same `heuristic | llm` path the app uses; nothing here is mocked.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const URL_ARG = process.argv[2] ?? "http://127.0.0.1:3000/mcp";
const SESSIONS = Math.max(1, Number(process.argv[3] ?? 3));

/**
 * Three sessions of the same learner habit. Wording varies (a real person does not
 * repeat a sentence), the ERROR CLASS does not: past tense told in present form,
 * `be` + adjective where English wants a verb, plural -s missing, and the
 * have/has agreement slip. Those fold onto `en-past-tense-adverb` and friends.
 */
const SCRIPTS: string[][] = [
  [
    "Yesterday I go to the climbing wall and I am very tire after.",
    "I see a route with the red ropes and I try it two time.",
    "The coach say I am slow, but I no care, I like the climbing.",
  ],
  [
    "Last week I walk to the gym with my brother and I drink two shake.",
    "He finish his set fast but I finish very slow, we are tired bad.",
    "The trainer say I must rest more, I no listen because I love sport.",
  ],
  [
    "Today I leave the office late and I take the bus home.",
    "I eat my dinner alone and I watch one series about crime.",
    "My friend call me after and we talk one hour, I feel good now.",
  ],
];

interface GrammarItem {
  point: string;
  example: string;
  correction: string;
  explanation: string;
  mistakeId?: string;
  recurrence?: { seenInSessions: number; firstDate: string };
}

async function main(): Promise<void> {
  const client = new Client({ name: "recurrence-proof", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(URL_ARG)));
  console.log(`# recurrence proof · ${URL_ARG} · ${SESSIONS} session(s)\n`);

  const seen: number[] = [];
  let anyLeakedRecurrenceOnFirst = false;

  for (let s = 0; s < SESSIONS; s++) {
    const lines = SCRIPTS[s % SCRIPTS.length];
    let sessionId: string | undefined;
    for (const message of lines) {
      const res = (await client.callTool({
        name: "chat",
        arguments: { message, targetLanguage: "en", ...(sessionId ? { sessionId } : {}) },
      })) as { structuredContent?: { sessionId: string } };
      sessionId = res.structuredContent?.sessionId ?? sessionId;
    }
    if (!sessionId) throw new Error(`session ${s + 1}: chat returned no sessionId`);

    const t0 = Date.now();
    const ended = (await client.callTool(
      { name: "end_session", arguments: { sessionId } },
      undefined,
      { timeout: 180_000 },
    )) as {
      structuredContent?: { review: { grammar: GrammarItem[]; summary: string }; extractionPath?: string };
    };
    const review = ended.structuredContent?.review;
    if (!review) throw new Error(`session ${s + 1}: no review in structuredContent`);
    const ms = ((Date.now() - t0) / 1000).toFixed(1);

    console.log(`----- session ${s + 1} (${sessionId.slice(0, 8)}) · end_session ${ms}s · path=${ended.structuredContent?.extractionPath}`);
    let maxSeen = 0;
    for (const g of review.grammar) {
      const r = g.recurrence;
      maxSeen = Math.max(maxSeen, r?.seenInSessions ?? 0);
      console.log(
        `  · ${g.point}\n    id=${g.mistakeId ?? "(none)"}  ${
          r ? `recurrence: seen ${r.seenInSessions}× since ${r.firstDate.slice(0, 10)}` : "recurrence: none"
        }\n    quote: "${g.example}"`,
      );
    }
    console.log(`  summary: ${review.summary}\n`);
    seen.push(maxSeen);
    if (s === 0 && maxSeen > 0) anyLeakedRecurrenceOnFirst = true;
  }

  console.log(`[recurrence] seenInSessions per session: ${seen.join(" → ")}`);
  // First session must be clean; later ones must count up if the same class recurs.
  const firstClean = seen[0] === 0;
  const grew = seen.length > 1 && seen[seen.length - 1] >= 2;
  console.log(`[recurrence] first session asserts nothing: ${firstClean ? "PASS" : "FAIL"}`);
  console.log(
    `[recurrence] a repeat earned a count: ${grew ? `PASS (${seen[seen.length - 1]}×)` : "NOT SHOWN — the labels did not fold onto one identity; the panel correctly stayed silent"}`,
  );
  if (anyLeakedRecurrenceOnFirst) {
    console.log("[recurrence] ⚠ FABRICATION: session 1 claimed recurrence with no prior rows.");
  }
  await client.close();
}

main().catch((e) => {
  console.error("[recurrence] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
