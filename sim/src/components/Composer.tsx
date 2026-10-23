import { FormEvent, KeyboardEvent, useState } from "react";
import { PRODUCT_NAME } from "../constants";

/**
 * The say-it bar: text input (always works) + optional mic toggle (voice mode).
 * The text path is the guaranteed fallback — voice never blocks it.
 *
 * `disabled` and `busy` are different things and used to be the same one. `disabled`
 * means "there is nothing to talk to" (the MCP link is down) and may grey the box;
 * `busy` means "a reply is in flight" and must NOT. Disabling the box while waiting
 * made the keyboard look broken for as long as the model took — you could not even
 * draft the next line, let alone correct the last one. So `busy` moves the gate to the
 * Send button and says out loud what it is waiting for.
 */
export function Composer({
  onSend,
  disabled,
  busy,
  placeholder,
  micButton,
}: {
  onSend: (text: string) => void;
  /** no connection: the box itself is dead */
  disabled?: boolean;
  /** a turn is in flight: type freely, Send waits */
  busy?: boolean;
  placeholder?: string;
  /** rendered beside the send button when voice mode is available/active */
  micButton?: React.ReactNode;
}) {
  const [draft, setDraft] = useState("");

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || disabled || busy) return;
    setDraft("");
    onSend(text);
  };

  return (
    <form className="composer" onSubmit={submit} data-testid="composer">
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter" && !e.shiftKey) submit();
        }}
        placeholder={placeholder ?? "Say something…"}
        disabled={disabled}
        aria-label="Message for Sala"
        data-testid="composer-input"
        autoComplete="off"
      />
      {micButton}
      <button
        type="submit"
        disabled={disabled || busy || !draft.trim()}
        aria-busy={busy || undefined}
        title={busy ? `${PRODUCT_NAME} is replying — your draft is safe, Send unlocks when the reply lands` : undefined}
        data-testid="composer-send"
      >
        {busy ? "Waiting for Sala…" : "Send"}
      </button>
    </form>
  );
}
