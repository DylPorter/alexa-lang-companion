import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  healthUrlFor,
  mcpUrlFromLocation,
  PRODUCT_NAME,
  SIMULATION_LABEL,
  LanguageCode,
} from "./constants";
import { SalaClient } from "./mcp/client";
import type { WireEvent } from "./mcp/wireLog";
import type { EndSessionResult, SessionRecord } from "./mcp/types";
import { chatRequestArgs, convReducer, initialConv } from "./state/conversation";
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
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [ending, setEnding] = useState(false);

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
    async (text: string) => {
      const client = clientRef.current;
      if (!client || conn.status !== "ready") return;
      dispatch({ type: "SEND", text, ts: Date.now() });
      try {
        const result = await client.chat(
          chatRequestArgs({ sessionId: sessionRef.current }, text, language),
        );
        sessionRef.current = result.sessionId;
        dispatch({ type: "REPLY", result, ts: Date.now() });
      } catch (err) {
        dispatch({ type: "FAIL", error: `chat failed: ${errMsg(err)}` });
      }
    },
    [conn.status, language],
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
    sessionRef.current = null;
    setReviewResult(null);
    dispatch({ type: "CLEAR" });
    setLanguage(code);
  }, []);

  const orbState: OrbState = conv.sending || ending ? "thinking" : "idle";
  const ready = conn.status === "ready";

  return (
    <div className="app">
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
          <ConversationPane turns={conv.turns} sending={conv.sending || ending} orbState={orbState} />
          {conv.error && (
            <div className="banner banner-error" role="alert" data-testid="conv-error">
              {conv.error}
            </div>
          )}
          <ActivityBar onLog={logActivity} disabled={!ready || conv.sending} />
          <div className="composer-row">
            <Composer
              onSend={send}
              disabled={!ready || conv.sending || ending}
              placeholder={
                conv.sessionEnded
                  ? "Session ended — type to start a new conversation…"
                  : `Talk to ${PRODUCT_NAME}…`
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
        </section>

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
      </main>

      <ToolInspector events={wire} open={inspectorOpen} onToggle={() => setInspectorOpen((o) => !o)} />

      <footer className="footer-note">
        {PRODUCT_NAME} (working name) · {SIMULATION_LABEL} · MCP: {mcpUrl}
      </footer>
    </div>
  );
}
