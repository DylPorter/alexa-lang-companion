import { FormEvent, useState } from "react";

/**
 * "I did something today" — quick activity logging (log_activity tool).
 * This seeds the memory the companion later genuinely recalls (the demo's
 * memory beat). Confirmation shows the stored id from the server, nothing else.
 */
export function ActivityBar({
  onLog,
  disabled,
}: {
  onLog: (text: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setFlash(null);
    try {
      await onLog(text);
      setDraft("");
      setFlash("Remembered ✓ — Sala will weave this into conversation when it's genuinely relevant.");
    } catch (err) {
      setFlash(`Could not log activity: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      window.setTimeout(() => setFlash(null), 6000);
    }
  };

  return (
    <div className="activity-bar" data-testid="activity-bar">
      <form onSubmit={submit} className="activity-form">
        <span className="activity-icon" aria-hidden>📝</span>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="I did something today… (log an activity Sala will remember)"
          disabled={disabled || busy}
          aria-label="Log an activity"
          data-testid="activity-input"
          autoComplete="off"
        />
        <button type="submit" disabled={disabled || busy || !draft.trim()} data-testid="activity-log">
          {busy ? "Logging…" : "Log"}
        </button>
      </form>
      {flash && (
        <div className="activity-flash" data-testid="activity-flash" role="status">
          {flash}
        </div>
      )}
    </div>
  );
}
