/**
 * Demo history — the two buttons on the sim's "Past sessions" panel.
 *
 * Filming needs a known starting state: an empty room for the first take, and a
 * learner with a past for the memory beats. Both routes give that through the CODE
 * that actually runs a session, not by inserting rows behind Sala's back:
 *
 *   wipeHistory()       → `MemoryStore.clearAll()`, this account only.
 *   loadSampleHistory() → four scripted conversations written as real message rows,
 *       then closed with `finishSession()` — the same function `end_session` calls —
 *       so the reviews are really extracted from those transcripts, the recurrence
 *       counts are really counted from `session_mistakes`, and the pending follow-up
 *       is really detected from the learner's own sentence.
 *
 * What IS authored is the script: the learner turns and Sala's replies are written
 * here, and the sessions are back-dated so the history reads as a week of
 * conversations rather than four rows created one second apart. That is exactly what
 * `scripts/recurrence-proof.ts` has been doing for filming since issue #2, turned
 * into a button. The sim carries the standing "Simulated Alexa+ experience" label, and
 * the panel says plainly that this history was loaded, not lived.
 *
 * The script is chosen so every cross-session feature has something to find: the same
 * English past-tense habit in three sessions (`en-past-tense-adverb` → recurrence and
 * emphasis), two French slips (`fr-past-marker-present`, `fr-beaucoup-de`), and a job
 * interview the NEXT session is asked about. `tests/demo-history.test.ts` asserts that
 * the script still fires, so rewording it cannot silently break the demo.
 */
import { MemoryStore } from "../memory/db.js";
import { finishSession } from "./session.js";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface ScriptedTurn {
  user: string;
  sala: string;
}

export interface ScriptedSession {
  /** Days before "now" the conversation is placed at. */
  daysAgo: number;
  /** Hours subtracted on top, so the panel shows distinct times instead of one stamp. */
  hourShift: number;
  language: string;
  turns: ScriptedTurn[];
  /** Activities the learner logged around that session (the `log_activity` path). */
  activities?: Array<{ text: string; hoursLater: number }>;
}

/** The scripted past. Order matters: sessions are closed oldest-first so the
 *  recurrence counts come out as 1 → 2 → 3 instead of all landing on one day. */
export const PRIOR_HISTORY: ScriptedSession[] = [
  {
    daysAgo: 9,
    hourShift: 0,
    language: "en",
    turns: [
      {
        user: "Yesterday I go to the climbing wall for the first time with my friend Daniel.",
        sala: "You WENT to the climbing wall? Nice — how did it go?",
      },
      {
        user: "It is very hard. I try one route three time and I fall down on the mat.",
        sala: "Falling is how you learn. Did the coach put you on an easier route?",
      },
      {
        user: "She say I am slow, but I no care, I like the climbing a lot.",
        sala: "That is the right attitude. Tell me which route you beat next time.",
      },
    ],
    activities: [{ text: "Went to the climbing wall for the first time", hoursLater: 1 }],
  },
  {
    daysAgo: 8,
    hourShift: 1,
    language: "en",
    turns: [
      {
        user: "Last week I go to the gym with my brother and we have two shake after.",
        sala: "You WENT to the gym with your brother? How long did the session last?",
      },
      {
        user: "He do his set very fast but I finish slow, my arms are dead now.",
        sala: "Dead arms mean you did it properly. Same time tomorrow?",
      },
    ],
    activities: [{ text: "Went to the gym with my brother", hoursLater: 1 }],
  },
  {
    daysAgo: 7,
    hourShift: 2,
    language: "fr",
    turns: [
      {
        user: "Hier je vais au marché et j'achète des fraises avec ma sœur.",
        sala: "Ah — hier tu ES ALLÉ au marché ? Vous avez acheté combien de fraises ?",
      },
      {
        user: "Beaucoup des gens sont là, et je suis 34 ans, je paie trop pour les fruits.",
        sala: "Beaucoup DE gens, et tu AS 34 ans. Les fraises étaient chères ?",
      },
    ],
  },
  {
    daysAgo: 6,
    hourShift: 3,
    language: "en",
    turns: [
      {
        user: "Yesterday I leave the office late and I take the bus home again.",
        sala: "You LEFT late? At least the bus lets you sit down. What did you do at home?",
      },
      {
        user: "I eat my dinner alone and I watch one series about crime.",
        sala: "A crime series and dinner — a good way to unwind. Who did it?",
      },
      {
        user: "I'm really stressed about my job interview on Monday, I don't know what to say.",
        sala: "Oh, a job interview! Everyone finds those nerve-wracking. What kind of role is it?",
      },
    ],
  },
];

/** Everything the panel needs to say what it just did, without the client guessing. */
export interface SeedOutcome {
  sessions: number;
  messages: number;
  activities: number;
  followUps: Array<{ topic: string; quote: string; saidAt: string; language: string }>;
  focus: Array<{ mistakeId: string; label: string; sessions: number; lastDate: string }>;
}

/**
 * Delete this account's stored history. Returns the per-table delete counts so the
 * caller (and the log line) can say what went, rather than just "ok".
 */
export function wipeHistory(memory: MemoryStore): Record<string, number> {
  const counts = memory.clearAll();
  console.log(
    `[demo] history wiped: ${counts.sessions} session(s), ${counts.messages} message(s), ` +
      `${counts.activities} activity(ies), ${counts.session_mistakes} mistake row(s), ` +
      `${counts.followups} pending follow-up(s)`,
  );
  return counts;
}

/**
 * Replace the stored history with `PRIOR_HISTORY`, closed through the real pipeline.
 * Reviews run on the deterministic heuristic path (`finishSession` gets no `llm`):
 * the button has to work with no key and no spend, and give the same rows on every
 * take. Seeding wipes first — "load prior history" means the room is set to a known
 * state, which is the whole reason the button exists on filming day.
 */
export async function loadSampleHistory(memory: MemoryStore): Promise<SeedOutcome> {
  wipeHistory(memory);
  const now = Date.now();
  let messages = 0;
  let activities = 0;

  for (const scripted of PRIOR_HISTORY) {
    const start = now - scripted.daysAgo * DAY_MS - scripted.hourShift * HOUR_MS;
    const sid = memory.createSession(scripted.language, "en");
    for (const activity of scripted.activities ?? []) {
      memory.logActivity(activity.text, new Date(start + activity.hoursLater * HOUR_MS).toISOString());
      activities += 1;
    }
    for (let i = 0; i < scripted.turns.length; i++) {
      const turn = scripted.turns[i]!;
      // Timestamps are set on the way in, so the follow-up's `said_at` is genuinely
      // the row's own created_at rather than something patched over afterwards.
      const at = new Date(start + i * 45_000).toISOString();
      memory.addMessage(sid, "user", turn.user, scripted.language, at);
      memory.addMessage(sid, "assistant", turn.sala, scripted.language, at);
      messages += 2;
    }
    // Closed the way a real session closes: extraction, mistake identities,
    // recurrence, follow-up capture — `end_session`'s own function.
    await finishSession(memory, undefined, sid);
    backdate(memory, sid, start);
  }

  const followUps = memory.pendingFollowUps({ limit: 10 });
  const focus = memory.recurringMistakes({ minSessions: 2, limit: 10 });
  console.log(
    `[demo] prior history loaded: ${PRIOR_HISTORY.length} session(s), ${messages} message(s), ` +
      `${activities} activity(ies) · waiting to ask: ${followUps.map((f) => f.topic).join(", ") || "none"}` +
      ` · recurring: ${focus.map((f) => `${f.mistakeId}×${f.sessions}`).join(", ") || "none"}`,
  );
  return {
    sessions: PRIOR_HISTORY.length,
    messages,
    activities,
    followUps: followUps.map((f) => ({
      topic: f.topic,
      quote: f.quote,
      saidAt: f.saidAt,
      language: f.language,
    })),
    focus,
  };
}

/**
 * Move one session's stored rows onto its scripted date. `messages.created_at` is
 * already right (written on the way in), and `followups.said_at` is read from those
 * rows, so what needs moving is the bookkeeping `finishSession` stamped with the real
 * clock: the session's own start/end and its mistake rows. The review it wrote
 * describes the transcript it was handed, so back-dating never changes a claim — it
 * only changes when the rows say they happened.
 */
function backdate(memory: MemoryStore, sessionId: string, startedAt: number): void {
  const at = new Date(startedAt).toISOString();
  const endedAt = new Date(startedAt + 6 * 60_000).toISOString();
  memory.db.transaction(() => {
    memory.db.prepare(`UPDATE sessions SET started_at = ?, ended_at = ? WHERE id = ?`).run(at, endedAt, sessionId);
    memory.db.prepare(`UPDATE session_mistakes SET recorded_at = ? WHERE session_id = ?`).run(at, sessionId);
  })();
}
