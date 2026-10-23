/**
 * Pure conversation state — no React, no I/O. Unit-tested:
 *  - sessionId pass-through: captured from the first chat reply, echoed back
 *    on every subsequent request (chatRequestArgs), cleared on session end.
 *  - memoryReferenced drives the "remembered" badge and NOTHING else.
 */
import type { ChatResult } from "../mcp/types";

export interface Turn {
  role: "user" | "assistant";
  text: string;
  /** assistant turns only: server said stored facts were genuinely recalled. */
  remembered?: boolean;
  /**
   * Display name of the new language. Assistant turns only, and only when the SERVER
   * changed language for this reply —
   * because the learner asked out loud. The transcript labels the handover instead of
   * silently restarting in another language, which is what makes a spoken switch
   * reviewable (and filmable) after the fact.
   */
  switchedTo?: string;
  ts: number;
}

export interface ConvState {
  sessionId: string | null;
  sessionEnded: boolean;
  turns: Turn[];
  sending: boolean;
  error: string | null;
}

export const initialConv: ConvState = {
  sessionId: null,
  sessionEnded: false,
  turns: [],
  sending: false,
  error: null,
};

export type ConvAction =
  | { type: "SEND"; text: string; ts: number }
  | { type: "REPLY"; result: ChatResult; ts: number }
  | { type: "FAIL"; error: string }
  | { type: "END_SESSION" }
  | { type: "CLEAR" };

export function convReducer(state: ConvState, action: ConvAction): ConvState {
  switch (action.type) {
    case "SEND":
      return {
        ...state,
        sending: true,
        error: null,
        turns: [...state.turns, { role: "user", text: action.text, ts: action.ts }],
      };
    case "REPLY":
      return {
        ...state,
        sending: false,
        sessionId: action.result.sessionId,
        turns: [
          ...state.turns,
          {
            role: "assistant",
            text: action.result.reply,
            remembered: action.result.memoryReferenced === true,
            // Only when the server actually moved the session — not merely because it
            // echoed back the language the picker already showed.
            switchedTo: action.result.languageChanged ? action.result.languageName : undefined,
            ts: action.ts,
          },
        ],
      };
    case "FAIL":
      return { ...state, sending: false, error: action.error };
    case "END_SESSION":
      // Keep the transcript visible (review references it); drop the id so the
      // next message honestly starts a NEW session.
      return { ...state, sessionId: null, sessionEnded: true, sending: false };
    case "CLEAR":
      return { ...initialConv };
  }
}

/**
 * The exact `chat` tool arguments for a user message.
 *
 * `targetLanguage` is sent ONLY to open a session. Re-asserting the picker every turn
 * would mean the device's local idea of the language outranks whatever the server
 * just switched to, so a learner saying "let's speak French" mid-session would be
 * silently overruled by their own stale UI. After the first turn the server owns the
 * session's language, reports it back in `language`, and the picker follows that.
 */
export function chatRequestArgs(
  state: Pick<ConvState, "sessionId">,
  message: string,
  targetLanguage: string,
): { message: string; sessionId?: string; targetLanguage?: string } {
  return state.sessionId
    ? { message, sessionId: state.sessionId }
    : { message, targetLanguage };
}
