/**
 * The end-of-session pipeline, in one place.
 *
 * `end_session` (the MCP tool) and the demo seeder (`src/server/demo.ts`) both have
 * to close a session the same way, and they must not disagree: extraction, mistake
 * identities, cross-session recurrence, the recurrence sentence, the ordering that
 * leads with standing habits, and the capture of anticipated events for the NEXT
 * session. Splitting it would mean the seeded "prior history" a filming take relies
 * on was produced by different code than a real session — so it is not split.
 */
import { MemoryStore, Review } from "../memory/db.js";
import { LLM } from "../llm/types.js";
import { detectFollowUps } from "../memory/followups.js";
import { DEFAULT_NATIVE_LANGUAGE } from "../config.js";
import {
  annotateRecurrence,
  extractReview,
  prioritiseRecurring,
  withMistakeIds,
} from "../review/extract.js";

export interface FinishedSession {
  review: Review;
  path: "heuristic" | "llm";
  /** Grammar points that carry a recurrence counted from real rows. */
  recurred: number;
  /**
   * Follow-ups stored by THIS call. A topic already pending from an earlier session
   * does not appear again — that is the dedupe index speaking, not a filter here.
   */
  followUps: Array<{ topic: string; quote: string; saidAt: string; language: string }>;
}

/**
 * The review summary's ONE recurrence sentence (issue #2). Both inputs come from
 * stored rows: `count` is how many grammar items in this review carry a real
 * `recurrence` (extraction caps grammar at 2, so this can never overstate), and
 * `firstDate` is the earliest recorded date among them. Never called with 0 — an
 * empty history must add nothing to the summary.
 */
export function appendRecurrenceSentence(
  summary: string,
  count: number,
  firstDate: string,
): string {
  const day = firstDate.slice(0, 10);
  const clause =
    count === 1
      ? `1 of these is a mistake you've made before, first logged on ${day}.`
      : `${count} of these are mistakes you've made before, first logged on ${day}.`;
  return `${summary.trimEnd()} ${clause}`;
}

/**
 * Close a session: review + rows for the cross-session features.
 * Returns `null` for an unknown (or other-account) session id, leaving the caller to
 * decide what "unknown" looks like on its surface.
 */
export async function finishSession(
  memory: MemoryStore,
  llm: LLM | undefined,
  sessionId: string,
): Promise<FinishedSession | null> {
  const session = memory.getSession(sessionId);
  if (!session) return null;

  const rows = memory.getTranscript(sessionId);
  const transcript = rows.map((m) => ({ role: m.role, content: m.content }));
  // Which languages were actually spoken, in order of appearance. Empty tags (rows
  // written before switching existed) do not count as a language of their own.
  const spoken = [...new Set(rows.map((r) => r.language).filter((l) => l !== ""))];
  const emphasis = memory.recurringMistakes({ language: session.language, minSessions: 2 });
  const { review, path } = await extractReview(
    transcript,
    {
      targetLanguage: session.language,
      nativeLanguage: DEFAULT_NATIVE_LANGUAGE,
      sessionLanguages: spoken.length > 1 ? spoken : undefined,
      emphasis: emphasis.length ? emphasis : undefined,
    },
    llm,
  );

  // ---- cross-session recurrence (issue #2) ---------------------------------
  // ORDER IS THE INTEGRITY GUARANTEE: `mistakeHistory` is read BEFORE
  // `endSession` writes this session's `session_mistakes` rows. Read after, the
  // count would include today and turn a first-time mistake into a fabricated
  // "you keep making this" — same rule as `memoryReferenced`.
  const withIds = withMistakeIds(review, session.language);
  const { review: annotated, recurred } = annotateRecurrence(withIds, (mistakeId) =>
    memory.mistakeHistory(mistakeId, sessionId),
  );
  // One sentence, only when rows back it: `recurred` counts the items that got a
  // real `recurrence`, and `firstSeen` is the earliest recorded date among them.
  // Both are read off the annotated review, so no number here is inferred, and
  // `recurred === 0` leaves the summary exactly as extraction wrote it.
  const firstSeen = annotated.grammar
    .map((g) => g.recurrence?.firstDate)
    .filter((d): d is string => typeof d === "string")
    .sort()[0];
  const led = prioritiseRecurring(annotated);
  const ended: Review =
    recurred > 0 && firstSeen
      ? { ...led, summary: appendRecurrenceSentence(led.summary, recurred, firstSeen) }
      : led;
  memory.endSession(sessionId, ended.summary, ended);

  // ---- anticipated events → next session's opener (cross-session follow-ups) ---------------
  // Learner turns ONLY, verbatim, through the deterministic cue tables. `said_at` is
  // the transcript row's own timestamp, so the follow-up Sala offers later can say
  // when they said it without anything being invented.
  const captured = detectFollowUps(
    rows
      .filter((r) => r.role === "user")
      .map((r) => ({ text: r.content, at: r.createdAt, language: r.language || session.language })),
    session.language,
  )
    .map((seed) => {
      const id = memory.recordFollowUp({ sessionId, ...seed });
      // null = that topic is already pending from an earlier session. Not a second row,
      // and not a second question about the same interview.
      return id === null ? null : { topic: seed.topic, quote: seed.quote, saidAt: seed.saidAt, language: seed.language };
    })
    .filter((f): f is FinishedSession["followUps"][number] => f !== null);

  return { review: ended, path, recurred, followUps: captured };
}
