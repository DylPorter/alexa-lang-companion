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
  const paneRef = useRef<HTMLDivElement | null>(null);
  const lastSwitch = turns[turns.length - 1]?.switchedTo;
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    // Scrolled HERE, not with `element.scrollIntoView()`: in device mode this pane sits
    // inside a second scrollable ancestor (`.app-device .chat-column`), and
    // scrollIntoView scrolls every ancestor it can reach. That dragged the whole column
    // up, clipping the top of the presence orb off the frame (measured y = -26px in the
    // browser pass, 2026-10-23) — and the orb is the first thing the camera sees.
    const scrollTo = (top: number) => {
      // Absent under jsdom (it implements no scrolling), so guard rather than throw in tests.
      if (typeof pane.scrollTo === "function") pane.scrollTo({ top, behavior: "smooth" });
    };
    // The ⇄ pill is the money shot of the spoken-switch beat, and it sits at the TOP of
    // Sala's bubble, which the usual pin-to-bottom pushed out of a 26vh pane. Show the
    // handover, then let the reply text flow below it.
    const pills = pane.querySelectorAll<HTMLElement>('[data-testid="language-switch"]');
    const pill = pills.length ? pills[pills.length - 1] : null;
    if (lastSwitch && pill) {
      scrollTo(pane.scrollTop + pill.getBoundingClientRect().top - pane.getBoundingClientRect().top - 12);
      return;
    }
    scrollTo(pane.scrollHeight);
  }, [turns.length, sending, interimTranscript, lastSwitch]);

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
    <div className="conversation" data-testid="conversation" ref={paneRef}>
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
    </div>
  );
}
