/**
 * The ambient orb motif — Sala's "presence". States drive the animation:
 * idle (slow breathe) · listening (fast pulse, voice mode) · thinking (swirl)
 * · speaking (glow rings, voice mode).
 */
export type OrbState = "idle" | "listening" | "thinking" | "speaking";

export function Orb({ state = "idle", size = "large" }: { state?: OrbState; size?: "large" | "small" }) {
  return (
    <div
      className={`orb orb-${state} orb-${size}`}
      role="img"
      aria-label={`Sala is ${state}`}
      data-testid="orb"
      data-state={state}
    >
      <div className="orb-core" />
      <div className="orb-ring" />
    </div>
  );
}
