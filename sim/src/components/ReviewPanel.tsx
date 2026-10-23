import type { EndSessionResult, FollowUp, Review } from "../mcp/types";

/**
 * The money shot: session review rendered EXCLUSIVELY from end_session's
 * structuredContent. `*.example` fields are the learner's verbatim sentences —
 * rendered as-is, never rewritten client-side.
 */
export function ReviewView({
  review,
  extractionPath,
  followUps,
}: {
  review: Review;
  extractionPath?: "heuristic" | "llm";
  /**
   * Only what the SERVER stored on this call (cross-session follow-ups). Absent or empty renders no
   * line at all: "nothing was remembered for next time" is not a claim to make, and
   * a client-side guess about the learner's future certainly isn't.
   */
  followUps?: FollowUp[];
}) {
  // Recurrence is server-counted from stored rows. Render ONLY what came back:
  // an item without `recurrence` gets no chip and no claim, because "never seen
  // before" is not something the server proved.
  const recurring = review.grammar.filter((g) => g.recurrence);
  return (
    <div className="review" data-testid="review-view">
      {recurring.length > 0 && (
        <p className="recurrence-note" data-testid="recurrence-note">
          {recurring.length === 1
            ? "1 grammar point here also came up in earlier sessions."
            : `${recurring.length} grammar points here also came up in earlier sessions.`}
        </p>
      )}
      {followUps && followUps.length > 0 && (
        <p
          className="followup-note"
          data-testid="followup-note"
          // The hover is the proof: the learner's own sentence, stored verbatim.
          title={followUps.map((f) => `“${f.quote}”`).join("\n")}
        >
          Saved for next time — Sala will ask how the{" "}
          {followUps.map((f) => f.topic).join(" and the ")} went.
        </p>
      )}
      <section className="review-section">
        <h3>Vocabulary from this conversation</h3>
        {review.vocabulary.length === 0 ? (
          <p className="review-empty">No vocabulary items were extracted from this session.</p>
        ) : (
          <ul className="vocab-cards">
            {review.vocabulary.map((v, i) => (
              <li className="vocab-card" key={`${v.word}-${i}`} data-testid="vocab-card">
                <div className="vocab-word">{v.word}</div>
                <blockquote className="learner-own-sentence">“{v.example}”</blockquote>
                {v.note && <div className="vocab-note">{v.note}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="review-section">
        <h3>Grammar</h3>
        {review.grammar.length === 0 ? (
          <p className="review-empty">No grammar points were extracted from this session.</p>
        ) : (
          <ul className="grammar-list">
            {review.grammar.map((g, i) => (
              <li className="grammar-card" key={`${g.point}-${i}`} data-testid="grammar-card">
                <div className="grammar-point">
                  {g.point}
                  {g.recurrence && (
                    <span
                      className="recurrence-chip"
                      data-testid="recurrence-chip"
                      title={`first seen ${g.recurrence.firstDate.slice(0, 10)}`}
                    >
                      recurring · seen {g.recurrence.seenInSessions}×
                    </span>
                  )}
                </div>
                <div className="grammar-pair">
                  <div className="grammar-said">
                    <span className="tag tag-said">you said</span> “{g.example}”
                  </div>
                  <div className="grammar-corrected">
                    <span className="tag tag-corrected">natural</span> “{g.correction}”
                  </div>
                </div>
                {g.explanation && <div className="grammar-explanation">{g.explanation}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="review-section">
        <h3>Summary</h3>
        <p className="review-summary" data-testid="review-summary">{review.summary}</p>
      </section>

      {extractionPath && (
        <p className="extraction-note">
          extracted from the actual transcript · path: {extractionPath}
        </p>
      )}
    </div>
  );
}

/** Right-pane panel wrapper: the just-ended session's review, or the empty state. */
export function ReviewPanel({ result }: { result: EndSessionResult | null }) {
  if (!result) {
    return (
      <div className="panel-empty" data-testid="review-empty-state">
        <p>No review yet.</p>
        <p className="panel-empty-hint">
          Have a conversation, then press <strong>End session</strong> — Sala generates a
          vocabulary + grammar review from what you actually said.
        </p>
      </div>
    );
  }
  return (
    <div data-testid="review-panel">
      <ReviewView
        review={result.review}
        extractionPath={result.extractionPath}
        followUps={result.followUps}
      />
    </div>
  );
}
