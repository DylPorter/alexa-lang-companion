import { useState } from "react";
import type { SessionRecord } from "../mcp/types";
import { ReviewView } from "./ReviewPanel";

/**
 * The "remembers every conversation" proof: list_sessions output with each
 * stored review expandable. Renders ONLY server data.
 */
export function PastSessions({
  sessions,
  loading,
  error,
  onRefresh,
}: {
  sessions: SessionRecord[] | null;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (loading) {
    return <div className="panel-empty" data-testid="sessions-loading">Loading past sessions…</div>;
  }
  if (error) {
    return (
      <div className="panel-empty panel-error" data-testid="sessions-error">
        <p>{error}</p>
        {onRefresh && <button onClick={onRefresh}>Retry</button>}
      </div>
    );
  }
  if (!sessions || sessions.length === 0) {
    return (
      <div className="panel-empty" data-testid="sessions-empty">
        <p>No past sessions yet.</p>
        <p className="panel-empty-hint">
          Every ended session appears here with its review — memory that survives across
          conversations.
        </p>
      </div>
    );
  }

  return (
    <div className="past-sessions" data-testid="past-sessions">
      {sessions.map((s) => {
        const open = openId === s.id;
        return (
          <div className="session-card" key={s.id} data-testid="session-card">
            <button
              className="session-header"
              onClick={() => setOpenId(open ? null : s.id)}
              aria-expanded={open}
            >
              <span className="session-date">{formatDate(s.date)}</span>
              <span
                className="session-lang"
                data-testid="session-lang"
                title={
                  s.languages && s.languages.length > 1
                    ? `this session switched: ${s.languages.join(", ")}`
                    : "language of this session"
                }
              >
                {s.languages?.length ? s.languages.join(" → ") : s.language}
              </span>
              <span className="session-chevron" aria-hidden>{open ? "▾" : "▸"}</span>
            </button>
            {s.summary && <p className="session-summary">{s.summary}</p>}
            {open &&
              (s.review ? (
                <ReviewView review={s.review} />
              ) : (
                <p className="review-empty">This session has no stored review.</p>
              ))}
          </div>
        );
      })}
      {onRefresh && (
        <button className="ghost-button" onClick={onRefresh} data-testid="sessions-refresh">
          ↻ Refresh
        </button>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
