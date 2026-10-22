/**
 * A2 persona QA probe — scripted conversations against a LIVE LLM backend
 * (default: the proxy from ambient env) over real MCP. Prints full transcripts
 * with memoryReferenced flags; docs/a2-qa.md records pass/fail per SPEC persona
 * contract item with snippets from this output.
 *
 *   SALA_LLM=proxy PORT=3101 SALA_DB_PATH=data/a2-qa.db npm start   (separate server)
 *   npx tsx scripts/a2-persona-qa.ts http://127.0.0.1:3101/mcp
 *
 * Conversational quality is NOT a CI test (nondeterministic); this is the
 * evidence generator for the human-readable checklist.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const URL_ARG = process.argv[2] ?? "http://127.0.0.1:3000/mcp";

interface Turn {
  role: "user" | "sala";
  text: string;
  remembered?: boolean;
}

async function main() {
  const client = new Client({ name: "a2-persona-qa", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(URL_ARG)));

  const chat = async (message: string, sessionId?: string, targetLanguage?: string) => {
    const res = (await client.callTool({
      name: "chat",
      arguments: { message, ...(sessionId ? { sessionId } : {}), ...(targetLanguage ? { targetLanguage } : {}) },
    })) as { structuredContent?: { reply: string; sessionId: string; memoryReferenced: boolean } };
    const sc = res.structuredContent;
    if (!sc) throw new Error("no structuredContent from chat");
    return sc;
  };
  const log = async (text: string) => {
    await client.callTool({ name: "log_activity", arguments: { text } });
  };

  interface Review {
    vocabulary: { word: string; example: string; note?: string }[];
    grammar: { point: string; example: string; correction: string; explanation: string }[];
    summary: string;
  }
  let frSessionId: string | undefined;
  const frTranscript: string[] = [];

  const dump = (title: string, turns: Turn[]) => {
    console.log(`\n===== ${title} =====`);
    for (const t of turns) {
      const flag = t.role === "sala" ? (t.remembered ? "  [remembered]" : "  [no-memory]") : "";
      console.log(`${t.role === "user" ? "USER" : "SALA"}: ${t.text}${flag}`);
    }
  };

  // P1 — friend-not-tutor + comprehensible input (EN)
  {
    const turns: Turn[] = [];
    let r = await chat("Hi Sala! I had a long day at work today.");
    turns.push({ role: "user", text: "Hi Sala! I had a long day at work today." }, { role: "sala", text: r.reply, remembered: r.memoryReferenced });
    r = await chat("It went okay I guess. What do you usually do in the evening?", r.sessionId);
    turns.push({ role: "user", text: "It went okay I guess. What do you usually do in the evening?" }, { role: "sala", text: r.reply, remembered: r.memoryReferenced });
    dump("P1 friend-not-tutor / comprehensible input (EN)", turns);
  }

  // P2 — correction rate: two consecutive mistake-heavy turns
  {
    const turns: Turn[] = [];
    let r = await chat("Yesterday I go to market and I buyed apples.");
    turns.push({ role: "user", text: "Yesterday I go to market and I buyed apples." }, { role: "sala", text: r.reply, remembered: r.memoryReferenced });
    r = await chat("Then I eated lunch with my friend and we was happy.", r.sessionId);
    turns.push({ role: "user", text: "Then I eated lunch with my friend and we was happy." }, { role: "sala", text: r.reply, remembered: r.memoryReferenced });
    dump("P2 correction rate (max ~1 recast per exchange)", turns);
  }

  // P3 — NO fabricated memories: ask about something never logged
  {
    const turns: Turn[] = [];
    const r = await chat("Hey Sala, what did I tell you about my trip to Japan last month?");
    turns.push({ role: "user", text: "Hey Sala, what did I tell you about my trip to Japan last month?" }, { role: "sala", text: r.reply, remembered: r.memoryReferenced });
    dump("P3 no fabricated memories (Japan never logged)", turns);
  }

  // P4 — positive control: logged activity IS recalled
  {
    await log("Practiced the piano for 40 minutes and learned a new Chopin piece");
    const turns: Turn[] = [];
    const r = await chat("Hi Sala! I finally sat down at the piano today.");
    turns.push({ role: "user", text: "Hi Sala! I finally sat down at the piano today." }, { role: "sala", text: r.reply, remembered: r.memoryReferenced });
    dump("P4 positive control (piano logged, then referenced)", turns);
  }

  // P5 — French exchange with learner mistakes
  {
    const turns: Turn[] = [];
    let r = await chat("Salut Sala ! Aujourd'hui je suis très content.", undefined, "fr");
    turns.push({ role: "user", text: "Salut Sala ! Aujourd'hui je suis très content." }, { role: "sala", text: r.reply, remembered: r.memoryReferenced });
    r = await chat("Hier je vais au cinema avec ma soeur et nous regardons un film.", r.sessionId, "fr");
    turns.push({ role: "user", text: "Hier je vais au cinema avec ma soeur et nous regardons un film." }, { role: "sala", text: r.reply, remembered: r.memoryReferenced });
    frSessionId = r.sessionId;
    frTranscript.push(turns[0].text, turns[2].text);
    dump("P5 French exchange (language + gentle recast)", turns);
  }

  // ---------------------------------------------------------------------------
  // P6-P9 — the film flow. Added 10-22 because P1-P5 stop short of the money shot:
  // nothing above closes a session, so end_session review quality, German (Alan's
  // demo language), the cross-session memory beat, and the verbatim-example
  // integrity rule had never been exercised against a live backend. This is the
  // evidence the Thursday recording run relies on.
  // ---------------------------------------------------------------------------

  const endSession = async (sessionId: string) => {
    const t0 = Date.now();
    const res = (await client.callTool(
      { name: "end_session", arguments: { sessionId } },
      undefined,
      { timeout: 180_000 },
    )) as { structuredContent?: { review: Review; extractionPath?: string }; isError?: boolean };
    if (!res.structuredContent) throw new Error(`end_session failed for ${sessionId}: ${JSON.stringify(res).slice(0, 200)}`);
    return { review: res.structuredContent.review, path: res.structuredContent.extractionPath ?? "?", secs: ((Date.now() - t0) / 1000).toFixed(1) };
  };

  // Integrity check: the SPEC promises review examples are the learner's OWN
  // sentences. Case/whitespace-insensitive substring test against the learner's
  // turns only — a paraphrased or invented example must show up as NOT-VERBATIM.
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const checkVerbatim = (label: string, review: Review, learnerTurns: string[]) => {
    const hay = learnerTurns.map(norm);
    const items = [
      ...review.vocabulary.map((v) => v.example),
      ...review.grammar.map((g) => g.example),
    ];
    const bad = items.filter((ex) => !hay.some((h) => h.includes(norm(ex)) || norm(ex).includes(h) && h.length > 8));
    const verdict = items.length === 0 ? "NO-ITEMS" : bad.length === 0 ? "PASS" : "FAIL";
    console.log(`[${label}] verbatim-from-transcript: ${verdict} (${items.length - bad.length}/${items.length})` +
      (bad.length ? `\n    not found in learner turns: ${JSON.stringify(bad.slice(0, 3))}` : ""));
    return verdict === "PASS";
  };

  const printReview = (label: string, review: Review, path: string, secs: string) => {
    console.log(`\n===== ${label} — extraction=${path} ${secs}s =====`);
    console.log(`  vocabulary (${review.vocabulary.length}):`);
    for (const v of review.vocabulary) console.log(`    - ${v.word} :: "${v.example}"${v.note ? ` (${v.note})` : ""}`);
    console.log(`  grammar (${review.grammar.length}):`);
    for (const g of review.grammar) console.log(`    - ${g.point}\n      said: "${g.example}"\n      recast: "${g.correction}"\n      why: ${g.explanation}`);
    console.log(`  summary: ${review.summary}`);
  };

  let frOk = false, enOk = false, deOk = false;
  if (frSessionId) {
    const { review, path, secs } = await endSession(frSessionId);
    printReview("P6 French review (money shot, FR)", review, path, secs);
    frOk = checkVerbatim("P6-FR", review, frTranscript);
  }

  // P7 — ESL: the demo's default language and the largest learner audience in the pitch.
  {
    const said = [
      "Yesterday I go to climbing wall for first time and it was very hard.",
      "But I feel myself proud because I did it.",
      "My friend did not come, he said he was too tireds.",
    ];
    const turns: Turn[] = [];
    let r = await chat(said[0]);
    turns.push({ role: "user", text: said[0] }, { role: "sala", text: r.reply, remembered: r.memoryReferenced });
    for (const m of said.slice(1)) {
      r = await chat(m, r.sessionId);
      turns.push({ role: "user", text: m }, { role: "sala", text: r.reply, remembered: r.memoryReferenced });
    }
    dump("P7 ESL exchange (tense + comparative + plural errors)", turns);
    const { review, path, secs } = await endSession(r.sessionId);
    printReview("P7 ESL review (money shot, EN)", review, path, secs);
    enOk = checkVerbatim("P7-EN", review, said);
  }

  // P8 — German, Alan's current target language: the claim most likely to be read
  // out on camera, and the one PRODUCT-FEEDBACK currently marks unverified.
  {
    const said = [
      "Hallo Sala! Ich bin sehr glucklich heute.",
      "Gestern ich habe gegangen zum Park mit meinem Freund und wir spielen Fussball.",
      "Ich habe ein Buch gelesen über die Geschichte von Berlin. Es war interessantest.",
    ];
    const turns: Turn[] = [];
    let r = await chat(said[0], undefined, "de");
    turns.push({ role: "user", text: said[0] }, { role: "sala", text: r.reply, remembered: r.memoryReferenced });
    for (const m of said.slice(1)) {
      r = await chat(m, r.sessionId, "de");
      turns.push({ role: "user", text: m }, { role: "sala", text: r.reply, remembered: r.memoryReferenced });
    }
    dump("P8 German exchange (verb position + past participle + superlative)", turns);
    const { review, path, secs } = await endSession(r.sessionId);
    printReview("P8 German review (money shot, DE)", review, path, secs);
    deOk = checkVerbatim("P8-DE", review, said);
  }

  // P9 — the video's Beat 1: a NEW session that already knows the user, then
  // list_sessions as the state-across-sessions proof.
  {
    const res = (await client.callTool({ name: "list_sessions", arguments: {} })) as {
      structuredContent?: { sessions: { id: string; language: string; summary: string | null; review: Review | null }[] };
    };
    const sessions = res.structuredContent?.sessions ?? [];
    const withReview = sessions.filter((s) => s.review && s.review.vocabulary.length + s.review.grammar.length > 0);
    console.log(`\n===== P9 state across sessions =====`);
    console.log(`  sessions stored: ${sessions.length}, with a stored review: ${withReview.length}`);
    for (const s of sessions.slice(0, 8)) {
      console.log(`    - ${s.language} ${s.id.slice(0, 8)} review=${s.review ? `v${s.review.vocabulary.length}/g${s.review.grammar.length}` : "none"} :: ${(s.summary ?? "").slice(0, 70)}`);
    }
    const openTurn = await chat("Hi Sala, I'm back.");
    console.log(`  new-session opener (memoryReferenced=${openTurn.memoryReferenced}): ${openTurn.reply}`);
    console.log(`[P9] stored-reviews: ${withReview.length >= 3 ? "PASS" : "FAIL"} (need every closed session recallable)`);
  }

  console.log(`\n[${"P6/P7/P8 money shot"}] verbatim integrity: FR=${frOk} EN=${enOk} DE=${deOk}`);
  await client.close();
  console.log("\nQA probe complete.");
}

main().catch((err) => {
  console.error("QA probe failed:", err);
  process.exit(1);
});
