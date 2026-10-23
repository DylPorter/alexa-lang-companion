import { useEffect, useRef } from "react";
import type { Turn } from "../state/conversation";
import { Orb } from "./Orb";
import { PRODUCT_NAME } from "../constants";

/**
 * The conversation pane: user + companion turns in the target language.
 * The "remembered" badge renders off `remembered` (server memoryReferenced)
 * ONLY — never faked (SPEC honesty rules).
 */
export function ConversationPane({
  turns,
  sending,
  interimTranscript,
  orbState,
}: {
  turns: Turn[];
  sending: boolean;
  /** live STT transcript while listening (voice mode); null when not listening */
  interimTranscript?: string | null;
  orbState?: "idle" | "listening" | "thinking" | "speaking";
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns.length, sending, interimTranscript]);

  const state = orbState ?? (sending ? "thinking" : "idle");

  if (turns.length === 0 && !interimTranscript) {
    return (
      <div className="conversation empty" data-testid="conversation-empty">
        <Orb state={state} size="large" />
        <p className="empty-hint">
          {PRODUCT_NAME} is here. Say hello — or log something you did today first, and
          watch {PRODUCT_NAME} remember it.
        </p>
      </div>
    );
  }

  return (
    <div className="conversation" data-testid="conversation">
      {turns.map((t, i) => (
        <div key={`${t.ts}-${i}`} className={`bubble bubble-${t.role}`}>
          {t.role === "assistant" && <Orb state="idle" size="small" />}
          <div className="bubble-body">
            {t.role === "assistant" && t.switchedTo && (
              <span
                className="language-switch"
                data-testid="language-switch"
                title="The learner asked for this out loud; Sala changed the session's language and kept the conversation going"
              >
                ⇄ now speaking {t.switchedTo}
              </span>
            )}
            <div className="bubble-text">{t.text}</div>
            {t.role === "assistant" && t.remembered && (
              <span className="remembered-badge" data-testid="remembered-badge" title="Sala referenced something genuinely stored in memory">
                ✦ remembered
              </span>
            )}
          </div>
        </div>
      ))}
      {interimTranscript && (
        <div className="bubble bubble-user interim" data-testid="interim-transcript">
          <div className="bubble-body">
            <div className="bubble-text">{interimTranscript}</div>
            <span className="listening-tag">🎙 listening…</span>
          </div>
        </div>
      )}
      {sending && (
        <div className="bubble bubble-assistant thinking" data-testid="thinking-indicator">
          <Orb state="thinking" size="small" />
          <div className="bubble-body">
            <div className="thinking-dots" aria-label="Sala is thinking">
              <span /> <span /> <span />
            </div>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
