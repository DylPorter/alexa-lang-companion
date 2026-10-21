import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  healthUrlFor,
  mcpUrlFromLocation,
  DEVICE_STATE_COPY,
  PRODUCT_NAME,
  SIMULATION_LABEL,
  LanguageCode,
} from "./constants";
import { SalaClient } from "./mcp/client";
import type { WireEvent } from "./mcp/wireLog";
import type { EndSessionResult, SessionRecord } from "./mcp/types";
import { chatRequestArgs, convReducer, initialConv } from "./state/conversation";
import { isDeviceMode, isModeToggleKey } from "./state/presentation";
import { micEnabled, voiceNext, VoiceEvent, VoiceState } from "./state/voiceMachine";
import { localeFor, startStt, sttSupported, SttHandle } from "./voice/stt";
import { cancelSpeech, DEFAULT_PIPER_URL, speak, TtsBackend } from "./voice/tts";
import { Orb, OrbState } from "./components/Orb";
import { ConversationPane } from "./components/ConversationPane";
import { Composer } from "./components/Composer";
import { ActivityBar } from "./components/ActivityBar";
import { LanguagePicker } from "./components/LanguagePicker";
import { ReviewPanel } from "./components/ReviewPanel";
import { PastSessions } from "./components/PastSessions";
import { ToolInspector } from "./components/ToolInspector";

type Conn =
  | { status: "connecting" }
  | { status: "ready"; backend?: string }
  | { status: "error"; error: string };

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function App() {
  const mcpUrl = useMemo(() => mcpUrlFromLocation(), []);
  const piperUrl = useMemo(
    () =>
      typeof window === "undefined"
        ? DEFAULT_PIPER_URL
        : (new URLSearchParams(window.location.search).get("tts") ?? DEFAULT_PIPER_URL),
    [],
  );
  const sttOk = useMemo(() => sttSupported(), []);
  /**
   * Headless-QA affordance (?voicedebug=1): injects an STT final transcript
   * through the EXACT mic path (state machine + speak()), for machines with no
   * microphone / no browser SR service. Visible + labeled when active; the
   * spoken reply is always real TTS. Not a demo shortcut — a test double for
   * the mic only.
   */
  const voiceDebug = useMemo(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("voicedebug"),
    [],
  );
  const [sttInjectDraft, setSttInjectDraft] = useState("");
  const [conn, setConn] = useState<Conn>({ status: "connecting" });
  const clientRef = useRef<SalaClient | null>(null);

  const [language, setLanguage] = useState<LanguageCode>("en");
  const [conv, dispatch] = useReducer(convReducer, initialConv);
  const sessionRef = useRef<string | null>(null);

  const [wire, setWire] = useState<WireEvent[]>([]);
  const onWire = useCallback((ev: WireEvent) => {
    setWire((prev) => [...prev.slice(-199), ev]);
  }, []);

  const [reviewResult, setReviewResult] = useState<EndSessionResult | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [sessionsErr, setSessionsErr] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sideTab, setSideTab] = useState<"review" | "sessions">("review");
  /**
   * Presentation mode (SPEC: the product is a speaker, the sim is the only
   * permitted surface). Device mode starts with the admin drawers shut so the
   * screen reads as a living-room product; `?device=0` or the `d` key brings the
   * full console back, including the wire inspector for the runtime-evidence beat.
   */
  const [device, setDevice] = useState(() => isDeviceMode());
  const [inspectorOpen, setInspectorOpen] = useState(() => !isDeviceMode());
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (isModeToggleKey(ev)) setDevice((d) => !d);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- voice mode: half-duplex, TTS-gated mic (state machine is pure logic)
  const [voice, setVoice] = useState<VoiceState>("idle");
  const [interim, setInterim] = useState<string | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [ttsBackend, setTtsBackend] = useState<TtsBackend | null>(null);
  const sttHandleRef = useRef<SttHandle | null>(null);
  const voiceEvent = useCallback((e: VoiceEvent) => setVoice((v) => voiceNext(v, e)), []);

  // ---- connect to the MCP server on mount
  useEffect(() => {
    let cancelled = false;
    const client = new SalaClient(mcpUrl, onWire);
    clientRef.current = client;
    (async () => {
      try {
        await client.connect();
        let backend: string | undefined;
        try {
          const h = await fetch(healthUrlFor(mcpUrl));
          const j = (await h.json()) as { ok?: boolean; backend?: string };
          if (j?.ok) backend = j.backend;
        } catch {
          /* health is a nicety; MCP connect is the real gate */
        }
        if (!cancelled) setConn({ status: "ready", backend });
      } catch (err) {
        if (!cancelled)
          setConn({
            status: "error",
            error: `Could not reach the Sala MCP server at ${mcpUrl} — ${errMsg(err)}. Start it with npm run dev.`,
          });
      }
    })();
    return () => {
      cancelled = true;
      clientRef.current = null;
      void client.close().catch(() => undefined);
    };
  }, [mcpUrl, onWire]);

  const refreshSessions = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    setSessionsLoading(true);
    setSessionsErr(null);
    try {
      const r = await client.listSessions();
      setSessions(r.sessions);
    } catch (err) {
      setSessionsErr(`list_sessions failed: ${errMsg(err)}`);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  // load past sessions once connected
  useEffect(() => {
    if (conn.status === "ready") void refreshSessions();
  }, [conn.status, refreshSessions]);

  // ---- actions
  const send = useCallback(
    async (text: string, mode: "text" | "voice" = "text") => {
      const client = clientRef.current;
      if (!client || conn.status !== "ready") return;
      dispatch({ type: "SEND", text, ts: Date.now() });
      try {
        const result = await client.chat(
          chatRequestArgs({ sessionId: sessionRef.current }, text, language),
        );
        sessionRef.current = result.sessionId;
        dispatch({ type: "REPLY", result, ts: Date.now() });
        if (mode === "voice") {
          // half-duplex: speak the reply, gate the mic until TTS finishes
          voiceEvent({ type: "REPLY_READY" });
          void speak(
            result.reply,
            language,
            {
              onStart: setTtsBackend,
              onEnd: () => voiceEvent({ type: "TTS_DONE" }),
              onUnavailable: (reason) => {
                setVoiceNotice(reason);
                voiceEvent({ type: "TTS_UNAVAILABLE" });
              },
            },
            piperUrl,
          );
        }
      } catch (err) {
        dispatch({ type: "FAIL", error: `chat failed: ${errMsg(err)}` });
        if (mode === "voice") voiceEvent({ type: "CHAT_ERROR" });
      }
    },
    [conn.status, language, piperUrl, voiceEvent],
  );

  const micToggle = useCallback(() => {
    if (voice === "listening") {
      sttHandleRef.current?.stop();
      sttHandleRef.current = null;
      setInterim(null);
      voiceEvent({ type: "MIC_OFF" });
      return;
    }
    if (!micEnabled(voice, sttOk, conv.sending || ending)) return;
    setVoiceNotice(null);
    voiceEvent({ type: "MIC_ON" });
    const handle = startStt(localeFor(language), {
      onInterim: (t) => setInterim(t),
      onFinal: (t) => {
        sttHandleRef.current = null;
        setInterim(null);
        voiceEvent({ type: "STT_FINAL" });
        void send(t, "voice");
      },
      onFail: (msg) => {
        sttHandleRef.current = null;
        setInterim(null);
        setVoiceNotice(msg);
        voiceEvent({ type: "STT_FAIL" });
      },
      onEmpty: () => {
        sttHandleRef.current = null;
        setInterim(null);
        setVoiceNotice("Didn't catch anything — tap the mic again, or just type.");
        voiceEvent({ type: "STT_FAIL" });
      },
    });
    sttHandleRef.current = handle;
  }, [voice, sttOk, conv.sending, ending, language, send, voiceEvent]);

  const injectSttFinal = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t || voice !== "idle") return;
      voiceEvent({ type: "MIC_ON" });
      voiceEvent({ type: "STT_FINAL" });
      void send(t, "voice");
    },
    [voice, send, voiceEvent],
  );

  const logActivity = useCallback(
    async (text: string) => {
      const client = clientRef.current;
      if (!client) throw new Error("not connected");
      await client.logActivity({ text });
    },
    [],
  );

  const endSession = useCallback(async () => {
    const client = clientRef.current;
    const sid = sessionRef.current;
    if (!client || !sid || ending) return;
    cancelSpeech();
    sttHandleRef.current?.stop();
    sttHandleRef.current = null;
    setInterim(null);
    setEnding(true);
    try {
      const result = await client.endSession({ sessionId: sid });
      setReviewResult(result);
      dispatch({ type: "END_SESSION" });
      sessionRef.current = null;
      setSideTab("review");
      void refreshSessions();
    } catch (err) {
      dispatch({ type: "FAIL", error: `end_session failed: ${errMsg(err)}` });
    } finally {
      setEnding(false);
    }
  }, [ending, refreshSessions]);

  const changeLanguage = useCallback((code: LanguageCode) => {
    // targetLanguage is per-session honest: switching clears the live session
    // (ended sessions stay in Past sessions with their stored language).
    cancelSpeech();
    sttHandleRef.current?.stop();
    sttHandleRef.current = null;
    setInterim(null);
    setVoice("idle");
    sessionRef.current = null;
    setReviewResult(null);
    dispatch({ type: "CLEAR" });
    setLanguage(code);
  }, []);

  // cleanup on unmount
  useEffect(() => () => cancelSpeech(), []);

  const orbState: OrbState =
    voice === "listening"
      ? "listening"
      : voice === "speaking"
        ? "speaking"
        : conv.sending || ending
          ? "thinking"
          : "idle";
  const ready = conn.status === "ready";

  return (
    <div className={`app${device ? " app-device" : ""}`} data-testid="app" data-mode={device ? "device" : "console"}>
      <header className="topbar">
        <div className="brand">
          <Orb state={orbState} size="small" />
          <h1>{PRODUCT_NAME}</h1>
          <span className="tagline">your living-room language companion</span>
        </div>
        <div className="topbar-mid">
          <LanguagePicker value={language} onChange={changeLanguage} disabled={!ready} />
        </div>
        <div className="topbar-right">
          <span className="sim-label" data-testid="sim-label" title="Required honesty label: this web app simulates the Alexa+ experience">
            {SIMULATION_LABEL}
          </span>
          <span
            className={`conn-status conn-${conn.status}`}
            data-testid="conn-status"
            title={conn.status === "ready" && conn.backend ? `LLM backend: ${conn.backend}` : undefined}
          >
            {conn.status === "connecting" && "connecting…"}
            {conn.status === "ready" && `● connected${conn.backend ? ` · ${conn.backend}` : ""}`}
            {conn.status === "error" && "● offline"}
          </span>
        </div>
      </header>

      {conn.status === "error" && (
        <div className="banner banner-error" data-testid="conn-error" role="alert">
          {conn.error}
        </div>
      )}

      <main className="layout">
        <section className="chat-column">
          {device && (
            // The presence orb is what a real Alexa device shows; in device mode it
            // leads the frame instead of sitting in a small brand slot.
            <div className="device-orb" data-testid="device-orb" aria-hidden="true">
              <Orb state={orbState} size="large" />
              <p className="device-state">{DEVICE_STATE_COPY[orbState]}</p>
            </div>
          )}
          <ConversationPane
            turns={conv.turns}
            sending={conv.sending || ending}
            orbState={orbState}
            interimTranscript={voice === "listening" ? interim : null}
          />
          {conv.error && (
            <div className="banner banner-error" role="alert" data-testid="conv-error">
              {conv.error}
            </div>
          )}
          <ActivityBar onLog={logActivity} disabled={!ready || conv.sending} />
          {device && reviewResult && (
            // Device mode puts the generated review where a real add-on would put a
            // card: in the conversation, not in a side pane (README: the MCP Apps path).
            <section className="device-review" data-testid="device-review" aria-label="Your review">
              <ReviewPanel result={reviewResult} />
            </section>
          )}
          <div className="composer-row">
            <Composer
              onSend={(t) => void send(t, "text")}
              disabled={!ready || conv.sending || ending}
              placeholder={
                conv.sessionEnded
                  ? "Session ended — type to start a new conversation…"
                  : `Talk to ${PRODUCT_NAME}…`
              }
              micButton={
                sttOk ? (
                  <button
                    type="button"
                    className={voice === "listening" ? "mic-button mic-listening" : "mic-button"}
                    onClick={micToggle}
                    // enabled while listening (manual stop) or when the gate allows arming
                    disabled={
                      !ready ||
                      (voice !== "listening" && !micEnabled(voice, sttOk, conv.sending || ending))
                    }
                    data-testid="mic-button"
                    aria-label={voice === "listening" ? "Stop listening" : `Speak to ${PRODUCT_NAME}`}
                    title={
                      voice === "listening"
                        ? "Stop listening"
                        : "Voice turn (half-duplex): the mic re-arms after Sala finishes speaking"
                    }
                  >
                    {voice === "listening" ? "■" : "🎙"}
                  </button>
                ) : undefined
              }
            />
            <button
              className="end-session"
              onClick={() => void endSession()}
              disabled={!ready || !sessionRef.current || conv.sending || ending}
              data-testid="end-session"
              title="Generate the review from what you actually said"
            >
              {ending ? "Generating review…" : "End session"}
            </button>
          </div>
          {(!sttOk || voiceNotice) && (
            <p className="voice-notice" data-testid="voice-notice" role="status">
              {!sttOk
                ? "Voice input isn't available in this browser (no Web Speech API) — the text path always works."
                : voiceNotice}
            </p>
          )}
          {voiceDebug && (
            <form
              className="voice-debug"
              data-testid="stt-inject-form"
              onSubmit={(e) => {
                e.preventDefault();
                injectSttFinal(sttInjectDraft);
                setSttInjectDraft("");
              }}
            >
              <span className="voice-notice">headless QA: STT test double →</span>
              <input
                type="text"
                value={sttInjectDraft}
                onChange={(e) => setSttInjectDraft(e.target.value)}
                placeholder="inject an STT final transcript (exact mic path)"
                data-testid="stt-inject-input"
              />
              <button type="submit" data-testid="stt-inject">
                Inject STT
              </button>
            </form>
          )}
        </section>

        {/* Device mode hides the admin column entirely; `d` brings it back. */}
        {!device && (
        <aside className="side-column">
          <nav className="side-tabs" aria-label="Panels">
            <button
              className={sideTab === "review" ? "tab tab-active" : "tab"}
              onClick={() => setSideTab("review")}
              data-testid="tab-review"
            >
              Review
            </button>
            <button
              className={sideTab === "sessions" ? "tab tab-active" : "tab"}
              onClick={() => setSideTab("sessions")}
              data-testid="tab-sessions"
            >
              Past sessions
            </button>
          </nav>
          <div className="side-body">
            {sideTab === "review" ? (
              <ReviewPanel result={reviewResult} />
            ) : (
              <PastSessions
                sessions={sessions}
                loading={sessionsLoading}
                error={sessionsErr}
                onRefresh={() => void refreshSessions()}
              />
            )}
          </div>
        </aside>
        )}
      </main>

      <ToolInspector events={wire} open={inspectorOpen} onToggle={() => setInspectorOpen((o) => !o)} />

      <footer className="footer-note">
        {PRODUCT_NAME} (working name) · {SIMULATION_LABEL} · voice I/O:{" "}
        {ttsBackend?.kind === "piper" ? ttsBackend.voiceLabel : "browser Web Speech API"} — the
        voice layer simulates Alexa+'s device-side ASR/TTS; the MCP server receives text, exactly
        like a real Alexa+ add-on · MCP: {mcpUrl}
      </footer>
    </div>
  );
}
