/**
 * Typed shapes of the Sala MCP tools' structuredContent — mirrors the zod
 * output schemas in src/server/tools.ts (A1). The sim renders ONLY from these
 * fields; nothing is invented client-side (honesty rules).
 */

/**
 * One thing the learner said they were waiting for, in an EARLIER session. Server-side
 * this is a `followups` row; `quote` is their own turn verbatim, so the panel can show
 * the memory rather than a paraphrase of it.
 */
export interface FollowUp {
  topic: string;
  quote: string;
  saidAt: string;
  language: string;
}

/** One grammar habit counted across past sessions (`session_mistakes` rows). */
export interface FocusHabit {
  mistakeId: string;
  label: string;
  /** DISTINCT past sessions — never the live one. */
  sessions: number;
  lastDate: string;
}

export interface ChatResult {
  reply: string;
  sessionId: string;
  /** True ONLY when stored facts were genuinely retrieved server-side. */
  memoryReferenced: boolean;
  isNewSession: boolean;
  /**
   * Follow-ups Sala was handed on THIS turn. Non-empty only on the message that opened
   * the session, and only once per event — so a "welcome back" appears on the opener
   * and nowhere else.
   */
  followUps: FollowUp[];
  /**
   * The language Sala is speaking for this reply. It can differ from what the client
   * asked for: the learner may have changed it by saying so.
   */
  language: string;
  /** True when THIS turn moved the session to a new language. */
  languageChanged: boolean;
  /** `language` spelled out by the server — no client-side name table to drift. */
  languageName: string;
}

export interface SetLanguageResult {
  sessionId: string;
  previousLanguage: string;
  language: string;
  languageName: string;
  changed: boolean;
}

export interface LogActivityResult {
  id: number;
}

export interface Activity {
  id: number;
  text: string;
  when: string;
  createdAt: string;
}

export interface PastSessionRef {
  id: string;
  date: string;
  language: string;
  summary: string | null;
  matchedMessage?: string;
}

export interface RecallResult {
  activities: Activity[];
  pastSessions: PastSessionRef[];
  /** What Sala is still waiting to ask about. Not filtered by `recall`'s query. */
  followUps?: FollowUp[];
  /** Habits counted across past sessions; what the chat turns are quietly drilling. */
  focus?: FocusHabit[];
}

export interface VocabItem {
  word: string;
  /** The learner's OWN sentence, verbatim — render as-is. */
  example: string;
  note?: string;
}

/**
 * Cross-session recurrence, as counted server-side from stored rows. Absent =
 * this mistake identity has no earlier session — the panel must show nothing,
 * not a "first time" claim (honesty rule, mirrors `memoryReferenced`).
 */
export interface GrammarRecurrence {
  /** DISTINCT sessions carrying this mistake identity, INCLUDING the current one. */
  seenInSessions: number;
  /** Earliest stored session date for it (ISO). */
  firstDate: string;
}

export interface GrammarItem {
  point: string;
  /** The learner's own (mistaken) sentence, verbatim. */
  example: string;
  /** Corrected form. */
  correction: string;
  explanation: string;
  /** Server-derived stable mistake identity; the exact key recurrence counts on. */
  mistakeId?: string;
  recurrence?: GrammarRecurrence;
}

export interface Review {
  vocabulary: VocabItem[];
  grammar: GrammarItem[];
  summary: string;
}

export interface EndSessionResult {
  review: Review;
  extractionPath: "heuristic" | "llm";
  /**
   * Anticipated events this session ADDED to the pending list — what Sala will open the
   * next session with. Empty means nothing new was stored, and the panel then says
   * nothing about the future (honesty rule: no claim without a row).
   */
  followUps?: FollowUp[];
}

export interface SessionRecord {
  id: string;
  date: string;
  language: string;
  /**
   * Every language the session covered, in order. `["en", "fr"]` for one where the
   * learner asked halfway through to change — rendered as "en → fr" rather than
   * claiming the whole conversation was the language it ended in.
   */
  languages?: string[];
  summary: string | null;
  review: Review | null;
}

export interface ListSessionsResult {
  sessions: SessionRecord[];
}
