import { useState } from "react";
import type { SessionRecord } from "../mcp/types";
import { ReviewView } from "./ReviewPanel";

/**
 * The "remembers every conversation" proof: list_sessions output with each
 * stored review expandable. Renders ONLY server data.
 *
 * The two demo-setup buttons live here because this panel IS the memory surface, and
 * they have to be visible in every state — including the empty one, which is precisely
 * when "load prior history" is wanted. They call plain HTTP routes on the Sala server
 * (`sim/src/mcp/demoApi.ts`), not MCP tools: a voice assistant should never be able to
 * enumerate a way to erase its user's memory.
 */
export function PastSessions({
  sessions,
  loading,
  error,
  onRefresh,
  onClear,
  onSeed,
  busy,
  notice,
}: {
  sessions: SessionRecord[] | null;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  /** Wipe every stored session for this account (server-side, this account only). */
  onClear?: () => void;
  /** Replace the history with the scripted prior sessions. */
  onSeed?: () => void;
  busy?: boolean;
  notice?: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  const controls = (onClear || onSeed) && (
    <div className="demo-controls" data-testid="demo-controls">
      {onSeed && (
        <button
          type="button"
          className="ghost-button"
          onClick={onSeed}
          disabled={busy}
          data-testid="seed-history"
          title="Replaces the stored history with four scripted sessions from the past week, closed through the real review pipeline."
        >
          ⤓ Load prior history
        </button>
      )}
      {onClear && (
        <button
          type="button"
          className="ghost-button ghost-danger"
          onClick={onClear}
          disabled={busy}
          data-testid="clear-history"
          title="Deletes every stored session, activity and pending follow-up for this account."
        >
          ✕ Clear all history
        </button>
      )}
      {busy && <span className="demo-busy">working…</span>}
      {notice && (
        <p className="demo-notice" data-testid="demo-notice">
          {notice}
        </p>
      )}
    </div>
  );

  if (loading) {
    return (
      <>
        <div className="panel-empty" data-testid="sessions-loading">Loading past sessions…</div>
        {controls}
      </>
    );
  }
  if (error) {
    return (
      <>
        <div className="panel-empty panel-error" data-testid="sessions-error">
          <p>{error}</p>
          {onRefresh && <button onClick={onRefresh}>Retry</button>}
        </div>
        {controls}
      </>
    );
  }
  if (!sessions || sessions.length === 0) {
    return (
      <>
        <div className="panel-empty" data-testid="sessions-empty">
          <p>No past sessions yet.</p>
          <p className="panel-empty-hint">
            Every ended session appears here with its review — memory that survives across
            conversations.
          </p>
        </div>
        {controls}
      </>
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
      {controls}
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
