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
    dump("P5 French exchange (language + gentle recast)", turns);
  }

  await client.close();
  console.log("\nQA probe complete.");
}

main().catch((err) => {
  console.error("QA probe failed:", err);
  process.exit(1);
});
