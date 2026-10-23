/**
 * Memory store — SQLite via better-sqlite3 (sync, zero-daemon; FTS5 verified
 * available on Node 22, SQLite 3.53.4). Recall = FTS5 keyword match + recency
 * ordering. NO embeddings in v1 (SPEC: honest simplicity), and the DB file is
 * the user's — copy it, back it up, delete it; that's the portability pitch.
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export interface Activity {
  id: number;
  text: string;
  when: string; // ISO timestamp of when it happened
  createdAt: string;
}

export interface SessionRow {
  id: string;
  date: string; // started_at
  language: string;
  summary: string | null;
  review: Review | null;
  endedAt: string | null;
}

export interface MessageRow {
  id: number;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  /**
   * Which language was in force for this turn. `""` means untagged — a row written
   * before language switching existed, or a session that never changed. Tagging is
   * what lets a session that started in English and finished in French say so in the
   * review instead of pretending the whole transcript was one language.
   */
  language: string;
}

export interface VocabItem {
  word: string;
  example: string; // the user's own sentence, verbatim
  note?: string;
}

export interface GrammarItem {
  point: string;
  example: string; // the user's own (mistaken) sentence, verbatim
  correction: string;
  explanation: string;
  /**
   * Stable identity for this mistake class (issue #2). Heuristic items carry the
   * `MISTAKE_TABLES` pattern id; LLM items get a folded/aliased key derived from
   * `point`. Optional so reviews stored before this existed still validate.
   */
  mistakeId?: string;
  /**
   * Only set when the SAME identity genuinely appears in stored rows from earlier
   * sessions. `seenInSessions` counts distinct prior sessions + this one, from real
   * rows — never inferred, never 1 by default. See `mistakeHistory`.
   */
  recurrence?: { seenInSessions: number; firstDate: string };
}

export interface Review {
  vocabulary: VocabItem[];
  grammar: GrammarItem[];
  summary: string;
}

/**
 * A pending cross-session follow-up (cross-session follow-ups), exactly as stored. `quote` is the
 * learner's OWN turn, verbatim — the whole feature rests on Sala being able to say
 * "you said X" and mean it, so nothing here is ever a paraphrase.
 */
export interface FollowUpRow {
  id: number;
  /** Canonical topic key ("interview") — the dedupe handle, not display text. */
  topic: string;
  quote: string;
  /** Language the quote arrived in (the reply is in the NEW session's language). */
  language: string;
  /** When the learner said it, from the transcript row (ISO). */
  saidAt: string;
  /** Session that ended with this still unanswered. */
  sessionId: string;
}

/**
 * One mistake class the learner has hit in several DIFFERENT sessions, counted from
 * `session_mistakes`. `sessions` never includes a live session — the rows for the
 * conversation in progress do not exist until `endSession` writes them.
 */
export interface RecurringMistake {
  mistakeId: string;
  label: string;
  sessions: number;
  /** Most recent recorded date for this identity (ISO). */
  lastDate: string;
}

export interface RecallResult {
  activities: Activity[];
  pastSessions: Array<{
    id: string;
    date: string;
    language: string;
    summary: string | null;
    matchedMessage?: string;
  }>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  language TEXT NOT NULL,
  native_language TEXT NOT NULL DEFAULT 'en',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  summary TEXT,
  review_json TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  account_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- language in force for this turn ('' = written before switching existed)
  language TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  text TEXT NOT NULL,
  when_ts TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- accent-insensitive tokenizer: learners type "gusto"/"gustó" interchangeably
CREATE VIRTUAL TABLE IF NOT EXISTS activities_fts USING fts5(
  text, content='activities', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content, content='messages', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS activities_ai AFTER INSERT ON activities BEGIN
  INSERT INTO activities_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;
-- Recurrence (issue #2): which mistake identities appeared in which sessions.
-- Deterministic identity + counting, NOT similarity search: "have I seen this
-- before" is an exact-key question, so it gets an exact key and a COUNT. No
-- embeddings, no vector index — same reason recall is FTS5 (SPEC: honest
-- simplicity), and it keeps the answer explainable on camera.
-- Additive and idempotent: existing sala.db files open unchanged with old
-- sessions intact.
-- point is the human-readable label as it was written, kept on the row so a
-- later session can name the habit without parsing another table's JSON. Rows
-- written before it existed hold '' and the reader falls back to the identity.
CREATE TABLE IF NOT EXISTS session_mistakes (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  account_id TEXT NOT NULL,
  mistake_id TEXT NOT NULL,
  language TEXT NOT NULL,
  point TEXT NOT NULL DEFAULT '',
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (session_id, mistake_id)
);
CREATE INDEX IF NOT EXISTS idx_session_mistakes
  ON session_mistakes(account_id, mistake_id, recorded_at);
-- Cross-session follow-up (cross-session follow-ups): something the learner said they were
-- waiting for, stored as their own words so the ask next time is a memory and
-- not a guess. offered_at is written ONCE, when Sala was handed the line:
-- an event gets asked about a single time, so a three-week-old interview does
-- not come back forever. The partial unique index is the dedupe — mentioning
-- the same topic in four sessions still leaves one pending question, and
-- SQLite enforces it rather than the code hoping it does.
CREATE TABLE IF NOT EXISTS followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  topic TEXT NOT NULL,
  quote TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT '',
  said_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  offered_at TEXT,
  offered_session TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_followups_pending
  ON followups(account_id, topic) WHERE offered_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_followups_account
  ON followups(account_id, offered_at, said_at);
`;

export class MemoryStore {
  readonly db: Database.Database;

  constructor(path: string, private readonly accountId: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  /**
   * Column additions for databases written before conversational language switching
   * existed. SQLite has no `ADD COLUMN IF NOT EXISTS`, so the table shape is read
   * first — this runs on every open and must stay a no-op once applied. Old DB files
   * (including the one holding the rehearsal sessions behind the recurrence chip)
   * have to keep opening, or the demo loses its own history.
   */
  private migrate(): void {
    const cols = (table: string) =>
      new Set(
        (this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
          (c) => c.name,
        ),
      );
    if (!cols("messages").has("language")) {
      this.db.exec(`ALTER TABLE messages ADD COLUMN language TEXT NOT NULL DEFAULT ''`);
    }
    if (!cols("session_mistakes").has("point")) {
      this.db.exec(`ALTER TABLE session_mistakes ADD COLUMN point TEXT NOT NULL DEFAULT ''`);
    }
  }

  // ------------------------------------------------------------------ sessions

  createSession(language: string, nativeLanguage: string, id: string = randomUUID()): string {
    this.db
      .prepare(
        `INSERT INTO sessions (id, account_id, language, native_language, started_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, this.accountId, language, nativeLanguage, new Date().toISOString());
    return id;
  }

  getSession(id: string): SessionRow | null {
    const row = this.db
      .prepare(`SELECT * FROM sessions WHERE id = ? AND account_id = ?`)
      .get(id, this.accountId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      date: row.started_at as string,
      language: row.language as string,
      summary: (row.summary as string | null) ?? null,
      review: row.review_json ? (JSON.parse(row.review_json as string) as Review) : null,
      endedAt: (row.ended_at as string | null) ?? null,
    };
  }

  listSessions(): SessionRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM sessions WHERE account_id = ? ORDER BY started_at DESC, rowid DESC`)
      .all(this.accountId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: row.id as string,
      date: row.started_at as string,
      language: row.language as string,
      summary: (row.summary as string | null) ?? null,
      review: row.review_json ? (JSON.parse(row.review_json as string) as Review) : null,
      endedAt: (row.ended_at as string | null) ?? null,
    }));
  }

  /**
   * Closes the session and records which mistake identities it contained.
   * Callers that want recurrence numbers on the panel must read `mistakeHistory`
   * BEFORE this runs: the rows written here include the current session, and a
   * count that silently includes today's own mistake would be a fake "you keep
   * making this" claim.
   */
  endSession(id: string, summary: string, review: Review): void {
    const now = new Date().toISOString();
    const language = this.getSession(id)?.language ?? "";
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE sessions SET ended_at = ?, summary = ?, review_json = ?
           WHERE id = ? AND account_id = ?`,
        )
        .run(now, summary, JSON.stringify(review), id, this.accountId);
      const ins = this.db.prepare(
        `INSERT OR IGNORE INTO session_mistakes
           (session_id, account_id, mistake_id, language, point, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const g of review.grammar) {
        if (!g.mistakeId) continue;
        ins.run(id, this.accountId, g.mistakeId, language, g.point ?? "", now);
      }
    })();
  }

  /**
   * How many EARLIER sessions contain this exact mistake identity, and when it
   * first appeared. DISTINCT session_id, because the same mistake recurring twice
   * in one old conversation is still one session's habit. Returns 0 when there is
   * no stored evidence — the caller must then omit `recurrence` entirely.
   */
  mistakeHistory(
    mistakeId: string,
    excludeSessionId: string,
  ): { priorSessions: number; firstDate: string | null } {
    const row = this.db
      .prepare(
        `SELECT COUNT(DISTINCT session_id) AS n, MIN(recorded_at) AS first_at
         FROM session_mistakes
         WHERE account_id = ? AND mistake_id = ? AND session_id != ?`,
      )
      .get(this.accountId, mistakeId, excludeSessionId) as { n: number; first_at: string | null };
    return { priorSessions: row.n ?? 0, firstDate: row.first_at ?? null };
  }

  // ---------------------------------------------------- follow-ups + emphasis
  // Both halves of the cross-session feature read the SAME two tables (`followups`,
  // `session_mistakes`) that the review panel already reads, so what Sala says in a
  // later session is provable against a row the user can see with `recall`.

  /**
   * Store one anticipated event the learner mentioned. Returns the new row's id, or
   * `null` when the topic is already pending — the partial unique index makes that a
   * fact about the database rather than a check that races itself.
   */
  recordFollowUp(input: {
    sessionId: string;
    topic: string;
    quote: string;
    language: string;
    saidAt: string;
  }): number | null {
    const info = this.db
      .prepare(
        `INSERT OR IGNORE INTO followups
           (account_id, session_id, topic, quote, language, said_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.accountId,
        input.sessionId,
        input.topic,
        input.quote,
        input.language,
        input.saidAt,
        new Date().toISOString(),
      );
    return info.changes === 1 ? Number(info.lastInsertRowid) : null;
  }

  /**
   * What Sala is waiting to ask about, newest first. Rows already offered are gone
   * for good: one event, one question. `excludeSessionId` keeps a session from being
   * handed its own news back if a client ever reuses an id.
   */
  pendingFollowUps(opts: { excludeSessionId?: string; limit?: number } = {}): FollowUpRow[] {
    const limit = Math.min(Math.max(opts.limit ?? 3, 1), 10);
    const rows = this.db
      .prepare(
        `SELECT id, topic, quote, language, said_at, session_id FROM followups
          WHERE account_id = ? AND offered_at IS NULL
            AND session_id != COALESCE(?, '')
          ORDER BY said_at DESC, id DESC LIMIT ?`,
      )
      .all(this.accountId, opts.excludeSessionId ?? null, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as number,
      topic: r.topic as string,
      quote: r.quote as string,
      language: (r.language as string) ?? "",
      saidAt: r.said_at as string,
      sessionId: r.session_id as string,
    }));
  }

  /**
   * Record that these follow-ups were handed to the model on a turn — the single
   * write that stops them being offered again. Named `offered`, not `asked`: what
   * the database can prove is that Sala was given the line. Whether the model then
   * actually asked is in the reply text, and the demo says so out loud.
   */
  markFollowUpsOffered(ids: number[], sessionId: string): void {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const upd = this.db.prepare(
      `UPDATE followups SET offered_at = ?, offered_session = ?
        WHERE account_id = ? AND id = ? AND offered_at IS NULL`,
    );
    this.db.transaction(() => {
      for (const id of ids) upd.run(now, sessionId, this.accountId, id);
    })();
  }

  /**
   * Mistake classes stored in at least `minSessions` DISTINCT earlier sessions,
   * busiest habit first. This is the "2+ mistakes about the same thing across
   * different sessions" gate, and it can only ever see ended sessions — the live
   * transcript is not in `session_mistakes` yet, so no count here claims the learner
   * has already repeated something this conversation.
   *
   * The language filter reads the identity's own prefix (`canonicalMistakeId` writes
   * `en-…`, `fr-…`), not the session's stored language, because a session that
   * switched halfway through ends tagged with only the language it finished in.
   */
  recurringMistakes(opts: {
    language?: string;
    minSessions: number;
    limit?: number;
  }): RecurringMistake[] {
    const limit = Math.min(Math.max(opts.limit ?? 3, 1), 10);
    const lang = opts.language?.toLowerCase().slice(0, 2);
    const rows = this.db
      .prepare(
        `SELECT mistake_id, COUNT(DISTINCT session_id) AS n, MAX(recorded_at) AS last_at
           FROM session_mistakes
          WHERE account_id = ? AND (? IS NULL OR substr(mistake_id, 1, 2) = ?)
          GROUP BY mistake_id
         HAVING n >= ?
          ORDER BY n DESC, last_at DESC LIMIT ?`,
      )
      .all(this.accountId, lang ?? null, lang ?? null, opts.minSessions, limit) as Array<{
      mistake_id: string;
      n: number;
      last_at: string;
    }>;
    return rows.map((r) => ({
      mistakeId: r.mistake_id,
      label: this.mistakeLabel(r.mistake_id),
      sessions: r.n,
      lastDate: r.last_at,
    }));
  }

  /**
   * Label for a mistake identity: the prose that was written with the most recent
   * row, or — for rows recorded before `point` existed — the identity itself made
   * readable. Never invented: there is no table of pretty names for mistake ids here.
   */
  private mistakeLabel(mistakeId: string): string {
    const row = this.db
      .prepare(
        `SELECT point FROM session_mistakes
          WHERE account_id = ? AND mistake_id = ? AND point <> ''
          ORDER BY recorded_at DESC, rowid DESC LIMIT 1`,
      )
      .get(this.accountId, mistakeId) as { point: string } | undefined;
    return row?.point ?? mistakeId.replace(/^[a-z]{2}-/, "").replace(/-/g, " ");
  }

  /**
   * Languages actually spoken in each given session, in the order they first appear.
   * One query for the whole page of sessions rather than one per row. Sessions whose
   * rows predate language tagging come back with an empty list — the caller decides how
   * to present that, because "we only know the language it ended in" is not the same
   * claim as "this session was entirely in that language".
   */
  languagesBySession(sessionIds: string[]): Record<string, string[]> {
    if (sessionIds.length === 0) return {};
    const placeholders = sessionIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT session_id, language FROM messages
         WHERE account_id = ? AND language <> '' AND session_id IN (${placeholders})
         GROUP BY session_id, language
         ORDER BY MIN(id) ASC`,
      )
      .all(this.accountId, ...sessionIds) as Array<{ session_id: string; language: string }>;
    const out: Record<string, string[]> = {};
    for (const r of rows) {
      (out[r.session_id] ??= []).push(r.language);
    }
    return out;
  }

  /**
   * Delete this account's stored history — sessions, transcripts, logged activities,
   * mistake rows and pending follow-ups (the cross-session follow-up work demo affordance: start clean between
   * takes without reaching for `rm data/sala.db`). One transaction, scoped to
   * `account_id` like every read.
   *
   * The FTS indexes are rebuilt from the content tables afterwards: an external-content
   * index does NOT follow deletes on its own, and a stale one would let `recall` answer
   * from rows that no longer exist — the one failure mode this store must not have.
   */
  clearAll(): Record<string, number> {
    const tables = [
      "followups",
      "session_mistakes",
      "messages",
      "activities",
      "sessions",
    ] as const;
    const counts: Record<string, number> = {};
    this.db.transaction(() => {
      for (const t of tables) {
        counts[t] = this.db
          .prepare(`DELETE FROM ${t} WHERE account_id = ?`)
          .run(this.accountId).changes;
      }
      this.db.exec(`INSERT INTO messages_fts(messages_fts) VALUES ('rebuild')`);
      this.db.exec(`INSERT INTO activities_fts(activities_fts) VALUES ('rebuild')`);
    })();
    return counts;
  }

  // ----------------------------------------------------------------- messages

  /**
   * Change the language a live session is spoken in. The session row keeps only the
   * CURRENT language (so Past sessions tags it correctly); the history of what was
   * spoken when lives in `messages.language`, not in a second column.
   */
  setSessionLanguage(sessionId: string, language: string): void {
    this.db
      .prepare(`UPDATE sessions SET language = ? WHERE id = ? AND account_id = ?`)
      .run(language, sessionId, this.accountId);
  }

  /**
   * `createdAt` defaults to now. It is settable for one reason — the demo seeder
   * writes a scripted past — and the FTS trigger fires on the INSERT either way, so a
   * back-dated row is searchable exactly like a live one.
   */
  addMessage(
    sessionId: string,
    role: "user" | "assistant",
    content: string,
    language = "",
    createdAt = new Date().toISOString(),
  ): void {
    this.db
      .prepare(
        `INSERT INTO messages (session_id, account_id, role, content, created_at, language)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(sessionId, this.accountId, role, content, createdAt, language);
  }

  getTranscript(sessionId: string): MessageRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages WHERE session_id = ? AND account_id = ? ORDER BY id ASC`,
      )
      .all(sessionId, this.accountId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as number,
      sessionId: r.session_id as string,
      role: r.role as "user" | "assistant",
      content: r.content as string,
      createdAt: r.created_at as string,
      language: (r.language as string | undefined) ?? "",
    }));
  }

  // ---------------------------------------------------------------- activities

  logActivity(text: string, when?: string): Activity {
    const now = new Date().toISOString();
    const info = this.db
      .prepare(
        `INSERT INTO activities (account_id, text, when_ts, created_at) VALUES (?, ?, ?, ?)`,
      )
      .run(this.accountId, text, when ?? now, now);
    return { id: Number(info.lastInsertRowid), text, when: when ?? now, createdAt: now };
  }

  // -------------------------------------------------------------------- recall

  /**
   * FTS5 keyword recall + recency ordering (SPEC: no embeddings).
   * - With `query`: tokenize into quoted FTS terms; matches ordered by bm25 rank
   *   then recency. Accent-insensitive (remove_diacritics 2).
   * - Without `query`: most recent stored material only.
   * - `since`: ISO date lower bound on created_at.
   * Activities from the recall exclude nothing; past sessions exclude `excludeSessionId`
   * (chat passes the current session so it doesn't "remember" its own live turns).
   */
  recall(opts: {
    query?: string;
    since?: string;
    limit?: number;
    excludeSessionId?: string;
  } = {}): RecallResult {
    const limit = Math.min(Math.max(opts.limit ?? 5, 1), 20);
    const match = opts.query ? toFtsQuery(opts.query) : null;

    let activities: Activity[];
    if (match) {
      activities = this.db
        .prepare(
          `SELECT a.id, a.text, a.when_ts, a.created_at, activities_fts.rank AS rank
             FROM activities_fts JOIN activities a ON a.id = activities_fts.rowid
            WHERE activities_fts MATCH ? AND a.account_id = ?
              AND (? IS NULL OR a.when_ts >= ?)
            ORDER BY activities_fts.rank, a.when_ts DESC, a.id DESC LIMIT ?`,
        )
        .all(match, this.accountId, opts.since ?? null, opts.since ?? null, limit)
        .map(mapActivity) as Activity[];
    } else {
      activities = this.db
        .prepare(
          `SELECT id, text, when_ts, created_at FROM activities
            WHERE account_id = ? AND (? IS NULL OR when_ts >= ?)
            ORDER BY when_ts DESC, id DESC LIMIT ?`,
        )
        .all(this.accountId, opts.since ?? null, opts.since ?? null, limit)
        .map(mapActivity) as Activity[];
    }

    let pastSessions: RecallResult["pastSessions"];
    if (match) {
      // sessions whose messages match, OR whose summary matches the query
      const rows = this.db
        .prepare(
          `SELECT s.id, s.started_at, s.language, s.summary, m.content AS matched
             FROM messages_fts
             JOIN messages m ON m.id = messages_fts.rowid
             JOIN sessions s ON s.id = m.session_id
            WHERE messages_fts MATCH ? AND s.account_id = ?
              AND s.id != COALESCE(?, '')
              AND (? IS NULL OR m.created_at >= ?)
            ORDER BY messages_fts.rank, m.created_at DESC, m.id DESC LIMIT ?`,
        )
        .all(
          match,
          this.accountId,
          opts.excludeSessionId ?? null,
          opts.since ?? null,
          opts.since ?? null,
          limit,
        ) as Array<Record<string, unknown>>;
      pastSessions = dedupeSessions(rows);
    } else {
      const rows = this.db
        .prepare(
          `SELECT s.id, s.started_at, s.language, s.summary,
                  (SELECT m.content FROM messages m
                    WHERE m.session_id = s.id AND m.role = 'user'
                    ORDER BY m.id DESC LIMIT 1) AS matched
             FROM sessions s
            WHERE s.account_id = ? AND s.ended_at IS NOT NULL AND s.id != COALESCE(?, '')
              AND (? IS NULL OR s.started_at >= ?)
            ORDER BY s.started_at DESC, s.rowid DESC LIMIT ?`,
        )
        .all(
          this.accountId,
          opts.excludeSessionId ?? null,
          opts.since ?? null,
          opts.since ?? null,
          limit,
        ) as Array<Record<string, unknown>>;
      pastSessions = dedupeSessions(rows);
    }

    return { activities, pastSessions };
  }
}

function mapActivity(r: unknown): Activity {
  const row = r as Record<string, unknown>;
  return {
    id: row.id as number,
    text: row.text as string,
    when: row.when_ts as string,
    createdAt: row.created_at as string,
  };
}

function dedupeSessions(rows: Array<Record<string, unknown>>): RecallResult["pastSessions"] {
  const seen = new Set<string>();
  const out: RecallResult["pastSessions"] = [];
  for (const r of rows) {
    const id = r.id as string;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      date: r.started_at as string,
      language: r.language as string,
      summary: (r.summary as string | null) ?? null,
      matchedMessage: (r.matched as string | null) ?? undefined,
    });
  }
  return out;
}

/**
 * Turn free text into a safe FTS5 MATCH expression: strip punctuation, quote
 * each token, OR them together (broad recall; bm25 + recency does the ranking).
 * Quoting every token neutralizes FTS5 operator characters.
 */
export function toFtsQuery(text: string): string | null {
  const tokens = text
    .toLowerCase()
    .replace(/["']/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return null;
  // dedupe, cap at 12 terms
  return [...new Set(tokens)]
    .slice(0, 12)
    .map((t) => `"${t}"`)
    .join(" OR ");
}
