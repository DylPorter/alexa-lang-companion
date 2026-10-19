// @vitest-environment jsdom
/**
 * ReviewPanel renders EXCLUSIVELY from end_session's structuredContent
 * (fixture below mirrors the A1 output schema). The learner's own sentences
 * must appear verbatim; empty state when no review yet.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReviewPanel, ReviewView } from "./ReviewPanel";
import { PastSessions } from "./PastSessions";
import type { EndSessionResult, SessionRecord } from "../mcp/types";

// vitest globals are off → RTL auto-cleanup doesn't self-register.
afterEach(cleanup);

const fixture: EndSessionResult = {
  review: {
    vocabulary: [
      { word: "climbing wall", example: "Yesterday I go to climbing wall.", note: "you tried this at the gym" },
      { word: "tired", example: "I am very tire after the gym." },
    ],
    grammar: [
      {
        point: "past tense of 'go'",
        example: "Yesterday I go to climbing wall.",
        correction: "Yesterday I went to the climbing wall.",
        explanation: "Use 'went' for the past tense of 'go'.",
      },
    ],
    summary: "We talked about your gym session and the climbing wall you tried.",
  },
  extractionPath: "llm",
};

describe("ReviewPanel", () => {
  it("shows the empty state before any session ends", () => {
    render(<ReviewPanel result={null} />);
    expect(screen.getByTestId("review-empty-state")).toBeTruthy();
    expect(screen.queryByTestId("review-panel")).toBeNull();
  });

  it("renders vocab cards with the learner's OWN sentences verbatim", () => {
    render(<ReviewPanel result={fixture} />);
    const cards = screen.getAllByTestId("vocab-card");
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain("Yesterday I go to climbing wall.");
    expect(cards[0].textContent).toContain("climbing wall");
    // uncorrected/mistaken sentences render AS-IS — never rewritten client-side
    expect(cards[1].textContent).toContain("I am very tire after the gym.");
  });

  it("renders grammar: said vs natural pair + explanation", () => {
    render(<ReviewPanel result={fixture} />);
    const g = screen.getAllByTestId("grammar-card")[0];
    expect(g.textContent).toContain("past tense of 'go'");
    expect(g.textContent).toContain("Yesterday I go to climbing wall.");
    expect(g.textContent).toContain("Yesterday I went to the climbing wall.");
    expect(g.textContent).toContain("Use 'went' for the past tense of 'go'.");
  });

  it("renders the summary and the extraction path honestly", () => {
    render(<ReviewPanel result={fixture} />);
    expect(screen.getByTestId("review-summary").textContent).toBe(fixture.review.summary);
    expect(screen.getByTestId("review-panel").textContent).toContain("path: llm");
  });

  it("renders explicit empty notes for empty vocab/grammar (never hides the section)", () => {
    render(
      <ReviewView
        review={{ vocabulary: [], grammar: [], summary: "Short session." }}
      />,
    );
    expect(screen.getByText(/No vocabulary items/)).toBeTruthy();
    expect(screen.getByText(/No grammar points/)).toBeTruthy();
  });
});

describe("PastSessions", () => {
  it("shows the empty state when no sessions are stored", () => {
    render(<PastSessions sessions={[]} />);
    expect(screen.getByTestId("sessions-empty")).toBeTruthy();
  });

  it("shows loading and error states", () => {
    render(<PastSessions sessions={null} loading />);
    expect(screen.getByTestId("sessions-loading")).toBeTruthy();
    render(<PastSessions sessions={null} error="list_sessions failed: boom" />);
    expect(screen.getByTestId("sessions-error").textContent).toContain("boom");
  });

  it("lists sessions with date, language, summary and expands to the stored review", () => {
    const sessions: SessionRecord[] = [
      { id: "s1", date: "2026-10-19T20:00:00.000Z", language: "fr", summary: "On a parlé du gymnase.", review: fixture.review },
    ];
    render(<PastSessions sessions={sessions} />);
    const card = screen.getAllByTestId("session-card")[0];
    expect(card.textContent).toContain("On a parlé du gymnase.");
    expect(screen.getByTestId("session-lang").textContent).toBe("fr");
    // expand
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByTestId("review-summary").textContent).toBe(fixture.review.summary);
  });
});
