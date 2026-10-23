import { LANGUAGES } from "../constants";

/**
 * Language picker — the product is language-ambiguous (SPEC §Positioning), so the demo
 * language is a UI switch, not a config edit.
 *
 * Picking a language RETARGETS the live session (`set_language`) rather than ending it:
 * the conversation stays, Sala carries on in the new language. The usual way to change
 * language out loud is simply to ask Sala for it, which is why this control is small and
 * the `currentName` chip below can show a language that has no button — a learner can ask
 * for Spanish, and nothing in this list is Spanish.
 */
export function LanguagePicker({
  value,
  onChange,
  disabled,
  currentName,
}: {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  /** Server-supplied name for the language in force, so no client-side table drifts. */
  currentName?: string;
}) {
  const listed = LANGUAGES.some((l) => l.code === value);
  return (
    <div className="language-picker" role="group" aria-label="Language Sala speaks" data-testid="language-picker">
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          className={`lang-option ${value === l.code ? "lang-active" : ""}`}
          onClick={() => onChange(l.code)}
          disabled={disabled}
          aria-pressed={value === l.code}
          data-testid={`lang-${l.code}`}
          title={`Sala will speak ${l.label}`}
        >
          <span aria-hidden>{l.flag}</span> {l.label}
        </button>
      ))}
      {!listed && (
        <span
          className="lang-option lang-active lang-current"
          data-testid="lang-current"
          title="Sala switched to this language because you asked out loud"
        >
          {currentName ?? value}
        </span>
      )}
    </div>
  );
}
