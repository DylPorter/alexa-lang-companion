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
}

export interface Review {
  vocabulary: VocabItem[];
  grammar: GrammarItem[];
  summary: string;
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
  created_at TEXT NOT NULL
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
`;

export class MemoryStore {
  readonly db: Database.Database;

  constructor(path: string, private readonly accountId: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
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

  endSession(id: string, summary: string, review: Review): void {
    this.db
      .prepare(
        `UPDATE sessions SET ended_at = ?, summary = ?, review_json = ?
         WHERE id = ? AND account_id = ?`,
      )
      .run(new Date().toISOString(), summary, JSON.stringify(review), id, this.accountId);
  }

  // ----------------------------------------------------------------- messages

  addMessage(sessionId: string, role: "user" | "assistant", content: string): void {
    this.db
      .prepare(
        `INSERT INTO messages (session_id, account_id, role, content, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(sessionId, this.accountId, role, content, new Date().toISOString());
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
