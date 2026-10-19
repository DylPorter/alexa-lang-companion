import { FormEvent, KeyboardEvent, useState } from "react";

/**
 * The say-it bar: text input (always works) + optional mic toggle (voice mode).
 * The text path is the guaranteed fallback — voice never blocks it.
 */
export function Composer({
  onSend,
  disabled,
  placeholder,
  micButton,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** rendered beside the send button when voice mode is available/active */
  micButton?: React.ReactNode;
}) {
  const [draft, setDraft] = useState("");

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || disabled) return;
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
      <button type="submit" disabled={disabled || !draft.trim()} data-testid="composer-send">
        Send
      </button>
    </form>
  );
}
