/**
 * Language identity + the "say it instead of tapping it" switch.
 *
 * There are two ways to change which language Sala speaks, because there are two
 * kinds of client:
 *   - a capable one (real Alexa+ does the understanding) calls `set_language`;
 *   - a person simply says "let's speak French" into the room. The server notices
 *     that here, so a demo with no natural-language-understanding layer still
 *     behaves like the product being described.
 * Both paths write the same persisted session property, so the persona prompt, the
 * review extraction and the sim's TTS voice all follow one truth.
 *
 * Detection is two-stage on purpose:
 *   1. find a token that IS a language we know (name or BCP-47 code), and
 *   2. require a REQUEST cue next to it ("let's", "can you", "switch to",
 *      "translate", "French please") — not merely a mention of a language.
 * Stage 2 is why "What's the word in French?" and "I speak French at work" do not
 * hijack a live session, while "let's speak French" does. Both cases are tested.
 */

export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  vi: "Vietnamese",
  ja: "Japanese",
  it: "Italian",
  pt: "Portuguese",
  ko: "Korean",
  zh: "Chinese",
};

export const KNOWN_LANGUAGE_CODES = Object.keys(LANGUAGE_NAMES);

export function languageName(code: string): string {
  return LANGUAGE_NAMES[code.toLowerCase()] ?? `the language with code "${code}"`;
}

/**
 * Lowercase, typographic apostrophe folded to ASCII, combining marks stripped — so
 * "français" / "Français" / "francais" and "let's" / "let’s" all compare alike.
 * Cues below are written in this folded space, which is why "uben" stands for "üben".
 */
function foldName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Every surface form a learner might say, folded — each language's own word for
 * itself included. Multi-word forms ("tiếng việt") are allowed.
 */
const ALIAS_TO_CODE: Record<string, string> = {
  ...Object.fromEntries(Object.entries(LANGUAGE_NAMES).map(([c, n]) => [foldName(n), c])),
  ...Object.fromEntries(KNOWN_LANGUAGE_CODES.map((c) => [c, c])),
  // …and what a learner calls each language in a language that ISN'T English, so a
  // French turn ("passons à l'allemand") resolves like an English one. Keys are folded
  // — lowercase, no combining marks — because that is the space `findLanguageTokens`
  // searches in. CJK forms are unaffected by folding and keep their own script.
  anglais: "en",
  ingles: "en",
  englisch: "en",
  espagnol: "es",
  espanol: "es",
  spanisch: "es",
  francais: "fr",
  frances: "fr",
  francese: "fr",
  franzosisch: "fr",
  "tieng viet": "vi",
  vietnamien: "vi",
  vietnamita: "vi",
  deutsch: "de",
  deutsche: "de",
  allemand: "de",
  aleman: "de",
  tedesco: "de",
  italiano: "it",
  italien: "it",
  italienisch: "it",
  portugues: "pt",
  portugais: "pt",
  portoghese: "pt",
  portugiesisch: "pt",
  coreano: "ko",
  coreen: "ko",
  koreanisch: "ko",
  chinois: "zh",
  chino: "zh",
  chinesisch: "zh",
  japonais: "ja",
  japones: "ja",
  japanisch: "ja",
  日本語: "ja",
  中文: "zh",
  한국어: "ko",
};

/** Longest surface forms first, so at one position "tieng viet" beats a shorter alias. */
const ALIASES_BY_LENGTH = Object.keys(ALIAS_TO_CODE).sort((a, b) => b.length - a.length);

/**
 * Accept a code ("fr", "FR", "de-DE" → "de") or a name in any spelling above.
 * Returns null for anything unknown: guessing which language a client meant is how
 * a session ends up speaking the wrong one on camera.
 */
export function normalizeLanguageCode(input: string): string | null {
  const folded = foldName(input);
  if (!folded) return null;
  const primary = folded.split(/[-_]/)[0];
  if (LANGUAGE_NAMES[primary]) return primary;
  return ALIAS_TO_CODE[folded] ?? ALIAS_TO_CODE[primary] ?? null;
}

/**
 * Cues that mean "I am asking you to change". Matched anywhere within a short
 * window BEFORE the language token. Bare `speak` and bare `say` are deliberately
 * absent — that is what keeps "I speak French at work" and "how do you say this in
 * French" inert. The polite, imperative and intent frames around them are what carry
 * the request.
 */
const REQUEST_CUES = [
  "let's", "lets", "let us", "how about", "shall we", "can we", "could we",
  "can you", "could you", "would you", "will you", "do you want to",
  "switch", "switchover", "change", "change over", "move", "convert", "set", "use",
  "translate", "repeat", "say that", "say it", "reply", "answer", "respond", "write",
  "continue", "carry on", "keep", "from now on", "start", "begin", "try", "only",
  "practice", "practise", "speak in", "talk in", "talk to me in",
  // Stated intent, which is a request even in a first-person sentence.
  "want to", "wanted to", "would like to", "'d like to", "like to", "need to",
  "going to", "would love to", "love to", "plan to", "intend to", "have to", "got to",
  // French
  "parlons", "parle", "parlez", "on parle", "passons", "passe", "passez",
  "changeons", "changez", "dis", "dites", "traduisez", "passe a",
  // German
  "lass uns", "lasst uns", "sprechen wir", "sprich", "sprechen sie", "wechsel", "wechseln wir", "uben",
  // Spanish
  "hablemos", "hable", "habla", "hablame", "cambiemos", "cambia", "cambie", "traduce", "di",
];

/** Cues that mean the same thing but trail the language: "French, please". */
const TRAILING_CUES = [
  "please", "now", "instead", "from now on", "only", "anymore",
  "si te plait", "si vous plait", "merci", "gracias", "por favor", "danke", "bitte",
];

/**
 * Self-report shapes. "I practice French every day", "we speak Spanish at home",
 * "how do you say thank you in Korean" are statements and questions ABOUT a language —
 * which is the whole point of a language-practice conversation — so they must not
 * hijack the session. A message carrying one still switches if it ALSO carries an
 * explicit ask (`DIRECTIVE_CUES`) or a stated intent (`DESIRE`).
 *
 * Word lists rather than one hand-rolled pattern, because the abbreviations lie:
 * `practi[sz]e` never matches "practice" (the letter is a c, not s/z) and `spa[kz]t`
 * never matches "spoke". Spelled-out words are checkable by eye.
 */
const SELF_REPORT_SUBJECTS = ["i", "we", "he", "she", "they", "it", "my", "his", "her", "their", "you"];
const SELF_REPORT_HABITS = [
  "also", "usually", "often", "sometimes", "really", "just", "never", "always", "probably",
  "every day", "at work", "at home", "in school", "nowadays", "used to",
];
const SELF_REPORT_VERBS = [
  "practice", "practise", "practicing", "speak", "speaks", "spoke", "speaking", "say", "says", "said",
  "study", "studies", "studied", "studying", "learn", "learns", "learning", "learnt",
  "know", "knows", "knew", "take", "takes", "took", "taking", "have", "has", "had", "use", "uses", "used",
];
const SELF_REPORT = new RegExp(
  `\\b(?:${SELF_REPORT_SUBJECTS.join("|")})\\s+(?:(?:${SELF_REPORT_HABITS.join("|")})\\s+)?(?:${SELF_REPORT_VERBS.join("|")})\\b`,
  "i",
);

/** "I want to speak Spanish" is first person and still a request. */
const DESIRE = /\b(?:want|wanted|would like|'d like|need|needs|love|loved|prefer|plan|hope|intend|trying|going|got|have)\s+to\b/i;

const DIRECTIVE_CUES = [
  "let's", "lets", "let us", "can you", "could you", "would you", "will you", "can we", "could we",
  "shall we", "switch", "change", "move", "convert", "translate", "repeat", "please", "now",
  "parlons", "parle", "parlez", "passons", "passe", "passez", "lass uns", "lasst uns", "sprich",
  "wechsel", "hablemos", "hable", "cambiemos", "cambia",
];

export interface LanguageSwitch {
  code: string;
  name: string;
  /** The words that triggered it, so a switch is explainable in a log or on camera. */
  matched: string;
}

const matchRequest = cueMatcher(REQUEST_CUES);
const matchTrailing = cueMatcher(TRAILING_CUES);
const matchDirective = cueMatcher(DIRECTIVE_CUES);

function escapeRe(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A cue matcher that respects word boundaries and allows any run of spaces inside a
 * phrase. Plain `includes()` is not good enough: "essay" contains "say", "know"
 * contains "now", "lonely" contains "only" — and each of those would flip a live
 * session's language. Compiled once per cue list, longest cue first so "can you"
 * wins over a shorter overlapping entry.
 */
function cueMatcher(cues: string[]): (window: string) => string | undefined {
  const sorted = [...cues].sort((a, b) => b.length - a.length);
  const pattern = sorted
    .map((c) => `(?<c${sorted.indexOf(c)}>${c.split(/\s+/).map(escapeRe).join("\\s+")})`)
    .join("|");
  // No /g: a stateful lastIndex on a module-level regex makes `exec` resume where the
  // LAST call stopped, so cues near the start of a later message go unnoticed. First
  // match is all we need.
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, "iu");
  return (window: string) => {
    const m = re.exec(window);
    if (!m) return undefined;
    // Groups are named c0, c1… after the cue's index in `sorted`.
    const hit = Object.entries(m.groups ?? {}).find(([, v]) => v !== undefined)?.[0];
    return hit === undefined ? m[0] : sorted[Number(hit.slice(1))];
  };
}

interface LangToken {
  code: string;
  index: number;
  end: number;
  surface: string;
}

/**
 * Every language token in the message, in the order they appear. Letters and digits
 * must be absent on both sides, so "english teacher" is a hit and "-inglish" is not;
 * CJK has no spaces between words but is still a `\p{L}` run, so the same guard holds.
 * At one position the longest surface form wins ("tiếng việt" beats a shorter alias).
 */
function findLanguageTokens(text: string): LangToken[] {
  const found: LangToken[] = [];
  for (const alias of ALIASES_BY_LENGTH) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(alias)}(?![\\p{L}\\p{N}])`, "giu");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // Aliases are folded, so the search runs on folded text; see `foldedAligned()`.
      const index = m.index;
      const end = index + m[0].length;
      const clash = found.findIndex((t) => index >= t.index && index < t.end);
      if (clash >= 0) {
        // A shorter alias inside an already-longer one is ignored; a longer one replaces it.
        if (end - index > found[clash].end - found[clash].index) found.splice(clash, 1);
        else {
          re.lastIndex = index + 1;
          continue;
        }
      }
      found.push({ code: ALIAS_TO_CODE[alias], index, end, surface: text.slice(index, end) });
      re.lastIndex = end;
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

/**
 * Does this message ask to change the language being spoken?
 *
 * Short codes ("it", "en", "de") are also English words, so a two-letter token only
 * counts when it sits right after an explicit change verb ("switch to pt"). A full
 * name needs only to be near a request cue.
 */
export function detectLanguageSwitch(input: string): LanguageSwitch | null {
  // Everything runs on the folded form, so "español"/"espanol" and "let's"/"let’s" are
  // one case. foldName() is length-preserving for the scripts we accept (NFD adds a
  // combining mark, the strip removes it), which is what keeps the character offsets
  // below meaningful; the folded text is only ever used to identify a language.
  const text = foldName(input);
  const tokens = findLanguageTokens(text);
  if (!tokens.length) return null;

  // Talking about a language is not the same as asking to be spoken to in it.
  if (SELF_REPORT.test(text) && !DESIRE.test(text) && !matchDirective(text)) return null;

  for (const token of tokens) {
    const before = text.slice(0, token.index);
    const after = text.slice(token.end);
    // Only the 80 characters leading up to the name, and 40 after it, are in scope:
    // a stray "can you" three sentences back should not license a language change.
    const nearPre = before.slice(-80);
    const nearPost = after.slice(0, 40);

    // "…practice my French" is a possession, not a request to be spoken to in French.
    if (/\b(?:my|his|her|their)\s*$/i.test(before)) continue;

    const preCue = matchRequest(nearPre);
    const trailCue = matchTrailing(nearPost);

    // A bare 2-3 letter code is indistinguishable from an English function word ("it",
    // "de"), so those need a change verb in front of them. Full names do not.
    const shortCode = /^[a-z]{2,3}$/.test(token.surface);
    const strongPre = /\b(?:switch|change|move|convert|set|use|reply|answer|translate)\w*\s+(?:to|into|over to|back to|in)\s*$/i.test(before);
    if (shortCode && !strongPre) continue;
    if (!preCue && !trailCue) continue;

    return {
      code: token.code,
      name: languageName(token.code),
      matched: `${(preCue ?? trailCue ?? "").trim()} ${token.surface}`.trim(),
    };
  }
  return null;
}
