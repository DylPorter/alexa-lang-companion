/**
 * Typed shapes of the Sala MCP tools' structuredContent — mirrors the zod
 * output schemas in src/server/tools.ts (A1). The sim renders ONLY from these
 * fields; nothing is invented client-side (honesty rules).
 */

export interface ChatResult {
  reply: string;
  sessionId: string;
  /** True ONLY when stored facts were genuinely retrieved server-side. */
  memoryReferenced: boolean;
  isNewSession: boolean;
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
}

export interface VocabItem {
  word: string;
  /** The learner's OWN sentence, verbatim — render as-is. */
  example: string;
  note?: string;
}

export interface GrammarItem {
  point: string;
  /** The learner's own (mistaken) sentence, verbatim. */
  example: string;
  /** Corrected form. */
  correction: string;
  explanation: string;
}

export interface Review {
  vocabulary: VocabItem[];
  grammar: GrammarItem[];
  summary: string;
}

export interface EndSessionResult {
  review: Review;
  extractionPath: "heuristic" | "llm";
}

export interface SessionRecord {
  id: string;
  date: string;
  language: string;
  summary: string | null;
  review: Review | null;
}

export interface ListSessionsResult {
  sessions: SessionRecord[];
}
