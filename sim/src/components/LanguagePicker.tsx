import { LANGUAGES, LanguageCode } from "../constants";

/**
 * Language picker — the product is language-ambiguous (SPEC §Positioning), so
 * the demo language is a UI switch, not a config edit. Changing language mid-
 * session ends the current conversation (targetLanguage is per-session honest).
 */
export function LanguagePicker({
  value,
  onChange,
  disabled,
}: {
  value: LanguageCode;
  onChange: (code: LanguageCode) => void;
  disabled?: boolean;
}) {
  return (
    <div className="language-picker" role="group" aria-label="Target language" data-testid="language-picker">
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
    </div>
  );
}
