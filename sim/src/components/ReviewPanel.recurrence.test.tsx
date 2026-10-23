// @vitest-environment jsdom
/**
 * Recurrence affordances in the review panel (issue #2).
 *
 * The negative case is the point: no `recurrence` field from the server means NO
 * chip and NO header line — the UI must not turn "we have no earlier rows" into a
 * claim about the learner's habits. `ReviewView` is the component the device view
 * (`?device=1`) renders inline, so the same chip is asserted there.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ReviewPanel, ReviewView } from "./ReviewPanel";
import type { EndSessionResult, GrammarItem } from "../mcp/types";

afterEach(cleanup);

const base: GrammarItem = {
  point: "Past tense after time markers",
  example: "Yesterday I go to climbing wall.",
  correction: "I went",
  explanation: "“Yesterday” puts the sentence in the past.",
  mistakeId: "en-past-tense-adverb",
};

const review = (grammar: GrammarItem[]): EndSessionResult => ({
  review: { vocabulary: [], grammar, summary: "You practiced English." },
  extractionPath: "heuristic",
});

describe("recurrence chip on a grammar card", () => {
  it("renders when the server sent a recurrence", () => {
    render(
      <ReviewPanel
        result={review([{ ...base, recurrence: { seenInSessions: 3, firstDate: "2026-10-19T20:00:00.000Z" } }])}
      />,
    );
    const chip = screen.getByTestId("recurrence-chip");
    expect(chip.textContent).toBe("recurring · seen 3×");
    expect(chip.getAttribute("title")).toBe("first seen 2026-10-19");
    expect(chip.className).toBe("recurrence-chip");
  });

  it("renders NOTHING when there is no recurrence — no count, no placeholder", () => {
    render(<ReviewPanel result={review([base])} />);
    expect(screen.queryByTestId("recurrence-chip")).toBeNull();
    expect(screen.queryByTestId("recurrence-note")).toBeNull();
    expect(screen.getByTestId("grammar-card").textContent).not.toMatch(/recurring|seen|earlier/);
  });

  it("marks only the recurring card when the review is mixed", () => {
    render(
      <ReviewPanel
        result={review([
          { ...base, recurrence: { seenInSessions: 2, firstDate: "2026-10-20T08:00:00.000Z" } },
          {
            ...base,
            point: "Third-person -s in the present",
            mistakeId: "en-third-person-s",
            example: "She work out every day.",
            correction: "she works out",
          },
        ])}
      />,
    );
    const cards = screen.getAllByTestId("grammar-card");
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector("[data-testid='recurrence-chip']")).not.toBeNull();
    expect(cards[1].querySelector("[data-testid='recurrence-chip']")).toBeNull();
  });
});

describe("recurrence line in the panel header", () => {
  it("counts the recurring items, singular and plural", () => {
    const withOne = review([
      { ...base, recurrence: { seenInSessions: 2, firstDate: "2026-10-20T08:00:00.000Z" } },
    ]);
    const one = render(<ReviewPanel result={withOne} />);
    expect(screen.getByTestId("recurrence-note").textContent).toBe(
      "1 grammar point here also came up in earlier sessions.",
    );
    one.unmount();

    const withTwo = render(
      <ReviewPanel
        result={review([
          { ...base, recurrence: { seenInSessions: 4, firstDate: "2026-10-11T08:00:00.000Z" } },
          {
            ...base,
            point: "Articles with specific places",
            mistakeId: "en-article-place",
            recurrence: { seenInSessions: 2, firstDate: "2026-10-18T08:00:00.000Z" },
          },
        ])}
      />,
    );
    expect(screen.getByTestId("recurrence-note").textContent).toBe(
      "2 grammar points here also came up in earlier sessions.",
    );
    withTwo.unmount();
  });

  it("the device view's inline review card shows the chip too (same ReviewView)", () => {
    render(
      <div className="app app-device">
        <ReviewView
          review={{
            vocabulary: [],
            grammar: [
              { ...base, recurrence: { seenInSessions: 2, firstDate: "2026-10-21T19:30:00.000Z" } },
            ],
            summary: "You practiced English.",
          }}
          extractionPath="heuristic"
        />
      </div>,
    );
    expect(screen.getByTestId("recurrence-chip").textContent).toBe("recurring · seen 2×");
    expect(screen.getByTestId("recurrence-note")).toBeTruthy();
  });
});
