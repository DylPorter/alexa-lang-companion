/**
 * End-of-session review extraction (SPEC's "money shot") — LANGUAGE-AGNOSTIC
 * (SPEC steered 10-20: nothing hardcoded to one language; per-language tables
 * are data, extraction logic is shared).
 *
 * Two paths, same contract:
 *  1. HEURISTIC (deterministic, offline, THE TESTED PATH): derive vocab + grammar
 *     items directly from the transcript — learner content words ranked by
 *     frequency, known mistake patterns for the target language matched against
 *     the learner's actual turns. Every `example` is the learner's OWN sentence,
 *     copied verbatim.
 *  2. LLM enhancement (Proxy/Bedrock only): one review pass over the transcript,
 *     output validated IN CODE — every example must be contained verbatim
 *     (modulo case/whitespace/quote-style) in a learner turn, and the
 *     transcript's own wording is authoritative (examples are re-sourced from
 *     the transcript, never taken from the model). Invalid or unavailable →
 *     fall back to the heuristic path.
 *
 * Honesty rule (carried from the fact-checker): review lists derive from the
 * actual transcript, never templates masquerading as extraction. If the learner
 * made no observable mistakes, `grammar` is empty — never fabricated.
 */
import { ChatMessage, LLM } from "../llm/types.js";
import { GrammarItem, Review, VocabItem } from "../memory/db.js";
import { PersonaConfig, reviewSystemPrompt } from "../persona/prompts.js";
import { languageName } from "../persona/languages.js";

/**
 * Extraction input IS the persona config: target language, learner L1, which
 * languages the session actually spoke (forwarded so a two-language conversation is
 * not described as a one-language one — the heuristic path ignores it, its tables are
 * keyed on `targetLanguage` alone), and which habits are on record (`emphasis`, so
 * the panel can lead with a standing mistake instead of burying it). One type, so
 * what the prompt is allowed to be told and what a caller can pass cannot drift apart.
 */
export interface ExtractionConfig extends PersonaConfig {}

// --------------------------------------------------------------- mistake tables

export interface MistakePattern {
  id: string;
  errorClass: "article" | "tense" | "preposition" | "word-order" | "agreement" | "gender" | "auxiliary" | "idiom";
  /** Matched against each learner sentence (case-insensitive). */
  re: RegExp;
  /** Corrected form; a function resolves it from the match groups. */
  correction: string | ((m: RegExpMatchArray) => string);
  point: string;
  explanation: string;
  vocabNote?: string;
}

const PAST_MAP: Record<string, string> = {
  go: "went", see: "saw", eat: "ate", play: "played", watch: "watched",
  have: "had", do: "did", visit: "visited", meet: "met", buy: "bought",
  come: "came", read: "read", write: "wrote", take: "took", make: "made",
};
const THIRD_PERSON_MAP: Record<string, string> = {
  go: "goes", watch: "watches", have: "has", do: "does",
  like: "likes", want: "wants", play: "plays", work: "works",
  live: "lives", eat: "eats", need: "needs", love: "loves",
};

/**
 * English ESL patterns — one per SPEC error class (articles, tense agreement,
 * prepositions, word order). Extensible data, not code.
 */
const MISTAKES_EN: MistakePattern[] = [
  {
    id: "en-past-tense-adverb",
    errorClass: "tense",
    re: /\b(yesterday|last night|last week|last weekend|last month)\b[^.!?]*\b(i|we|he|she|they)\s+(go|see|eat|play|watch|have|do|visit|meet|buy|come|read|write|take|make)\b/i,
    correction: (m) => `${m[2]} ${PAST_MAP[m[3].toLowerCase()] ?? m[3]}`,
    point: "Past tense after time markers",
    explanation:
      "“Yesterday” puts the sentence in the past, so the verb takes its past form: “I go” becomes “I went”.",
    vocabNote: "past tense: go → went, see → saw, have → had",
  },
  {
    id: "en-article-place",
    errorClass: "article",
    re: /\b(?:to|at|in|near)\s+(gym|park|office|beach|cinema|kitchen|store|supermarket|library|climbing wall|wall|doctor|dentist)\b/i,
    correction: (m) => `the ${m[1].toLowerCase()}`,
    point: "Articles with specific places",
    explanation:
      "English needs “the” before a specific place you go to: “to the gym”, “to the climbing wall”.",
    vocabNote: "go to THE + place (the gym, the park, the office)",
  },
  {
    id: "en-third-person-s",
    errorClass: "agreement",
    re: /\b(he|she)\s+(go|like|want|play|watch|work|live|eat|need|love|have|do)\b/i,
    correction: (m) => `${m[1]} ${THIRD_PERSON_MAP[m[2].toLowerCase()] ?? m[2] + "s"}`,
    point: "Third-person -s in the present",
    explanation: "With he/she/it in the present tense, the verb takes -s: “she works”, “he goes”.",
    vocabNote: "he/she + verb-s (works, likes, goes)",
  },
  {
    id: "en-depend-prep",
    errorClass: "preposition",
    re: /\bdepend(?:s|ed|ing)?\s+of\b/i,
    correction: "depend on",
    point: "“Depend ON”, not “depend of”",
    explanation: "The fixed preposition is “on”: “it depends on the weather”.",
    vocabNote: "to depend on something",
  },
  {
    id: "en-married-prep",
    errorClass: "preposition",
    re: /\bmarried\s+with\b/i,
    correction: "married to",
    point: "“Married TO”, not “married with”",
    explanation: "English says “she is married to him” — “with” is a common transfer mistake.",
    vocabNote: "to be married to someone",
  },
  {
    id: "en-am-agree",
    errorClass: "word-order",
    re: /\b(?:i\s+)?am\s+agree\b/i,
    correction: "I agree",
    point: "“Agree” is a verb: “I agree”",
    explanation: "English uses the verb directly — “I agree”, never “I am agree”.",
    vocabNote: "to agree (verb): I agree with you",
  },
];

/** Présent → passé composé for the common irregulars/-er verbs (FR tense marker). */
const FR_PAST_MAP: Record<string, string> = {
  vais: "suis allé", vient: "suis venu", reste: "suis resté",
  achète: "ai acheté", mange: "ai mangé", fais: "ai fait",
  prends: "ai pris", regarde: "ai regardé",
};

/**
 * French learner patterns (second fixture language; Dylan's own learning story).
 * Same error-class taxonomy where it maps.
 */
const MISTAKES_FR: MistakePattern[] = [
  {
    id: "fr-passe-compose-aller",
    errorClass: "auxiliary",
    re: /\bj'?ai all[ée]s?(?=[\s.,!?;:]|$)/i,
    correction: "je suis allé(e)",
    point: "« Aller » takes être in the passé composé",
    explanation:
      "Movement verbs like « aller » use être, not avoir: « je suis allé », « je suis allée ».",
    vocabNote: "je suis allé(e) = I went (with être)",
  },
  {
    id: "fr-beaucoup-de",
    errorClass: "preposition",
    re: /\bbeaucoup des\b/i,
    correction: "beaucoup de",
    point: "« Beaucoup DE », never « beaucoup des »",
    explanation: "Quantity adverbs are followed by « de » (which elides before a vowel): « beaucoup de travail ».",
    vocabNote: "beaucoup de = a lot of",
  },
  {
    id: "fr-age-avoir",
    errorClass: "idiom",
    re: /\bje suis (\d+) ans\b/i,
    correction: (m) => `j'ai ${m[1]} ans`,
    point: "Age uses « avoir »: « j'ai … ans »",
    explanation: "French states age with avoir (to have), not être: « j'ai trente ans ».",
    vocabNote: "j'ai X ans = I am X years old",
  },
  {
    id: "fr-voiture-gender",
    errorClass: "gender",
    re: /\b(?:le|un)\s+voiture\b/i,
    correction: "la voiture",
    point: "Gender: « la voiture » (feminine)",
    explanation: "« Voiture » is feminine: « la voiture », « une voiture ».",
    vocabNote: "la voiture = the car (feminine)",
  },
  {
    // The shape the live A2 FR demo actually produced ("Hier je vais au marché"):
    // past time marker + present tense. Mirrors en-past-tense-adverb.
    id: "fr-past-marker-present",
    errorClass: "tense",
    re: /\b(?:hier|la semaine dernière|le week-end dernier|ce matin)\b[^.!?]*?\bje\s+(vais|vient|reste|achète|mange|fais|prends|regarde)\b/i,
    correction: (m) => `je ${FR_PAST_MAP[m[1].toLowerCase()] ?? m[1]}`,
    point: "Passé composé after past time markers",
    explanation:
      "« Hier » puts the sentence in the past: « je vais » becomes « je suis allé », « j'achète » becomes « j'ai acheté ».",
    vocabNote: "passé composé: aller → je suis allé, acheter → j'ai acheté",
  },
  {
    id: "fr-elision-je",
    errorClass: "idiom",
    re: /\bje\s+(ai|habite|achète|adore|arrive|appelle|espère)\b/i,
    correction: (m) => `j'${m[1].toLowerCase()}`,
    point: "Elision: « j' » before a vowel",
    explanation:
      "« Je » elides to « j' » before a vowel sound: « j'ai », « j'habite », « j'achète » — never « je ai ».",
    vocabNote: "j'ai = I have / I've (elided je ai)",
  },
];

/** Small German table so a German session isn't grammar-blind (Alan's lane). */
const MISTAKES_DE: MistakePattern[] = [
  {
    id: "de-perf-haben-sein",
    errorClass: "auxiliary",
    // one optional intervening word so "ich habe gestern gegangen" is caught too
    re: /\bich habe (?:\w+\s)?(gegangen|gefahren|gelaufen|gekommen)\b/i,
    correction: (m) => `ich bin ${m[1].toLowerCase()}`,
    point: "Perfekt with sein for movement verbs",
    explanation: "Movement verbs take sein in the Perfekt: „ich bin gegangen“, not „ich habe gegangen“.",
    vocabNote: "ich bin gegangen = I went",
  },
  {
    id: "de-article-feminine",
    errorClass: "gender",
    re: /\bder (stadt|wohnung|schule|straße|strasse)\b/i,
    correction: (m) => `die ${m[1].toLowerCase()}`,
    point: "Gender: „die Stadt“ (feminine)",
    explanation: "These nouns are feminine and take „die“ in the nominative: „die Stadt“, „die Wohnung“.",
    vocabNote: "die Stadt / die Wohnung (feminine)",
  },
  {
    id: "de-accusative-der",
    errorClass: "article",
    re: /\b(?:ich sehe|ich habe|ich kenne|ich mag|ich brauche|ich suche)\s+der\s+(mann|junge|hund|freund|kaffee|tee|apfel|wagen|schlüssel|schluessel)\b/i,
    correction: (m) => `den ${m[1].toLowerCase()}`,
    point: "Accusative: „den Mann“ (masculine direct object)",
    explanation: "A masculine direct object takes „den“ in the accusative: „ich sehe den Mann“, not „ich sehe der Mann“.",
    vocabNote: "der Mann → ich sehe DEN Mann (accusative)",
  },
];

/** Small Spanish table (kept minimal — no fixture, but the demo may pick it). */
const MISTAKES_ES: MistakePattern[] = [
  {
    id: "es-ser-estar-agree",
    errorClass: "idiom",
    re: /\bsoy de acuerdo\b/i,
    correction: "estoy de acuerdo",
    point: "«Estar de acuerdo», not «ser de acuerdo»",
    explanation: "Agreement is a state, so Spanish uses estar: «estoy de acuerdo».",
    vocabNote: "estar de acuerdo = to agree",
  },
  {
    id: "es-gustar-accent",
    errorClass: "tense",
    re: /\bme gusto\b(?!ó)/i,
    correction: "me gustó",
    point: "Preterite accent: «me gustó»",
    explanation: "Past tense carries the accent: «me gustó» (I liked it). «Me gusto» means “I like myself”.",
    vocabNote: "me gustó = I liked it (past)",
  },
];

export const MISTAKE_TABLES: Record<string, MistakePattern[]> = {
  en: MISTAKES_EN,
  fr: MISTAKES_FR,
  de: MISTAKES_DE,
  es: MISTAKES_ES,
};

export function mistakeTableFor(lang: string): MistakePattern[] {
  return MISTAKE_TABLES[lang.toLowerCase().slice(0, 2)] ?? [];
}

// ------------------------------------------------- mistake identity (issue #2)

/**
 * Cross-session recurrence needs one identity per mistake CLASS, and the two
 * extraction paths name things differently: the heuristics carry a stable table id
 * (`de-perf-haben-sein`), while the model writes prose labels it invents each time
 * ("Present perfect auxiliary选择", "Perfekt: sein with motion"). This maps the
 * prose onto the table id.
 *
 * Deterministic string normalisation + a data table — no embeddings, no similarity
 * search, no extra LLM call. A repeat is an exact fact ("this id was stored in N
 * earlier sessions"), and it stays reproducible in a test. If a label does not map,
 * it keeps its own normalised slug, so the same wording still matches itself in
 * later sessions instead of being silently dropped.
 */
const MISTAKE_ALIASES: Record<string, string> = {
  // EN
  "en-past-simple": "en-past-tense-adverb",
  "en-simple-past": "en-past-tense-adverb",
  "en-past-tense": "en-past-tense-adverb",
  "en-past-tense-with-finished-time-adverb": "en-past-tense-adverb",
  "en-third-person-s": "en-third-person-s",
  "en-third-person-singular": "en-third-person-s",
  "en-subject-verb-agreement-third-person": "en-third-person-s",
  "en-articles": "en-article-place",
  "en-article-usage": "en-article-place",
  "en-indefinite-article-with-place": "en-article-place",
  "en-dependent-prepositions": "en-depend-prep",
  "en-preposition-after-depend": "en-depend-prep",
  "en-married-preposition": "en-married-prep",
  "en-am-agreement": "en-am-agree",
  "en-i-am-vs-i-is": "en-am-agree",
  // FR
  "fr-passe-compose-aller": "fr-passe-compose-aller",
  "fr-passed-composite-with-aller": "fr-passe-compose-aller",
  "fr-auxiliary-etre-with-aller": "fr-passe-compose-aller",
  "fr-beaucoup-de": "fr-beaucoup-de",
  "fr-quantifier-beaucoup": "fr-beaucoup-de",
  "fr-age-avoir": "fr-age-avoir",
  "fr-age-with-avoir": "fr-age-avoir",
  "fr-voiture-gender": "fr-voiture-gender",
  "fr-feminine-noun-gender": "fr-voiture-gender",
  "fr-past-marker-present": "fr-past-marker-present",
  "fr-hier-with-present-tense": "fr-past-marker-present",
  "fr-elision-je": "fr-elision-je",
  "fr-je-elision-before-vowel": "fr-elision-je",
  // DE
  "de-perfekt-haben-sein": "de-perf-haben-sein",
  "de-perfekt-auxiliary": "de-perf-haben-sein",
  "de-perfekt-with-sein": "de-perf-haben-sein",
  "de-sein-perfekt": "de-perf-haben-sein",
  "de-present-perfect-auxiliary-sein": "de-perf-haben-sein",
  "de-partizip-ii-sein": "de-perf-haben-sein",
  "de-article-feminine": "de-article-feminine",
  "de-feminine-article-die-eine": "de-article-feminine",
  "de-accusative-der": "de-accusative-der",
  "de-accusative-article-den": "de-accusative-der",
  // ES
  "es-ser-estar-agree": "es-ser-estar-agree",
  "es-ser-estar-agreement": "es-ser-estar-agree",
  "es-gustar-accent": "es-gustar-accent",
  "es-preterite-accent": "es-gustar-accent",
};

/** Fold a label to a comparable ASCII slug: no case, no accents, no punctuation. */
export function mistakeSlug(label: string): string {
  return fold(label)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Canonical identity for a grammar point. Heuristic items already know it; this is
 * for model-written labels, and it prefers a real table id over a slug so both
 * paths agree on the same key.
 */
export function canonicalMistakeId(lang: string, label: string, tableId?: string): string {
  const l = lang.toLowerCase().slice(0, 2);
  if (tableId) return tableId;
  const slug = mistakeSlug(label);
  const aliased = MISTAKE_ALIASES[`${l}-${slug}`];
  if (aliased) return aliased;
  // exact label of a known pattern (folded): the cheapest reliable bridge
  const hit = mistakeTableFor(l).find((p) => mistakeSlug(p.point) === slug);
  if (hit) return hit.id;
  return `${l}-${slug}`;
}

/**
 * Give every grammar item a mistake identity, without overwriting the ids the
 * heuristic path already knows. Called by the server after extraction because both
 * paths arrive here: heuristic items carry a table id, model items carry prose.
 */
export function withMistakeIds(review: Review, lang: string): Review {
  return {
    ...review,
    grammar: review.grammar.map((g) => ({
      ...g,
      mistakeId: g.mistakeId ?? canonicalMistakeId(lang, g.point),
    })),
  };
}

/** Read-only view of a mistake's stored history, so extraction stays testable without a DB. */
export type MistakeHistoryLookup = (
  mistakeId: string,
) => { priorSessions: number; firstDate: string | null };

/**
 * Attach `recurrence` to grammar items that genuinely appeared in EARLIER sessions,
 * and return the count for the summary line. Mutates nothing the caller did not
 * already own: items without a `mistakeId`, or with no stored history, get no
 * `recurrence` field at all — "you keep making this" is only said when a row says so.
 */
export function annotateRecurrence(
  review: Review,
  history: MistakeHistoryLookup,
): { review: Review; recurred: number } {
  let recurred = 0;
  const grammar = review.grammar.map((g) => {
    if (!g.mistakeId) return g;
    const h = history(g.mistakeId);
    if (h.priorSessions < 1 || !h.firstDate) return g;
    recurred += 1;
    return { ...g, recurrence: { seenInSessions: h.priorSessions + 1, firstDate: h.firstDate } };
  });
  return { review: { ...review, grammar }, recurred };
}

/**
 * Lead with the habits (the recurrence half): grammar items that carry a real
 * `recurrence` go first, so the panel opens on the thing the learner has now said
 * twice. Order only — no item is added, dropped, reworded or re-scored, and the
 * two groups keep their existing relative order. An unrecurred review is returned
 * untouched, so this can never reorder something it has no evidence about.
 */
export function prioritiseRecurring(review: Review): Review {
  const recurring = review.grammar.filter((g) => g.recurrence);
  if (recurring.length === 0) return review;
  const firstTime = review.grammar.filter((g) => !g.recurrence);
  return { ...review, grammar: [...recurring, ...firstTime] };
}

// --------------------------------------------------------------- stopword lists

/** Small per-language function-word lists — everything else is content. */
const STOPWORDS: Record<string, string> = {
  en: `a an the and or but if then than that this these those of to in on at by for
    with without from up down out off over under again further once here there when
    where why how all any both each few more most other some such no nor not only
    own same so too very can will just don should now i me my myself we us our ours
    you your yours he him his she her hers it its they them their theirs what which
    who whom be been being am is are was were do does did doing have has had having
    would could might must shall about into through during before after above below
    also really very much many well back even still way thing things like go went`,
  fr: `a à au aux avec ce ces dans de des du elle en et eux je la le les leur lui ma
    mais me même mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se
    ses son sur ta te tes toi ton tu un une vos votre vous c d j l m n s t y était
    être avoir fait je suis es sommes sont ai as ont`,
  de: `der die das und oder aber mit von zu in im an auf für ist sind war waren ich
    du er sie es wir ihr sie mich dich mir dir den dem des ein eine einen einer
    nicht auch so wie was wer wo wann sehr schon noch nur über um nach bei aus`,
  es: `a al algo con de del el ella en es fue hoy la las lo los mas me mi muy nada
    ni no nos o para pero por que se su sus te tiene todo tu un una y ya yo fue
    fui ser estar muy poco mucho`,
};

export function stopwordsFor(lang: string): Set<string> {
  const list = STOPWORDS[lang.toLowerCase().slice(0, 2)] ?? STOPWORDS.en;
  return new Set(list.split(/\s+/).filter(Boolean));
}

// --------------------------------------------------------------- helpers

/** Case/whitespace/quote folding for matching ONLY — never for display. */
export function fold(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokenize(text: string): string[] {
  return fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 4);
}

function splitSentences(turn: string): string[] {
  return turn.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim().length > 0);
}

/** The learner's own sentence containing `wordFolded`, verbatim from the transcript. */
function findExampleSentence(userTurns: string[], wordFolded: string): string | null {
  for (const turn of userTurns) {
    for (const sentence of splitSentences(turn)) {
      if (tokenize(sentence).some((t) => t === wordFolded)) return sentence.trim();
    }
  }
  return null;
}

// --------------------------------------------------------------- heuristic path

export interface DetectedMistake {
  pattern: MistakePattern;
  userSentence: string; // verbatim from the transcript
  matchedText: string; // the erroneous span, verbatim
  correction: string; // resolved from the pattern
}

/** Scan learner turns against the target language's mistake table. */
export function detectMistakes(transcript: ChatMessage[], lang: string): DetectedMistake[] {
  const table = mistakeTableFor(lang);
  const found: DetectedMistake[] = [];
  const seen = new Set<string>(); // one example per pattern is enough for a review
  for (const turn of transcript) {
    if (turn.role !== "user") continue;
    for (const sentence of splitSentences(turn.content)) {
      for (const pattern of table) {
        if (seen.has(pattern.id)) continue;
        const m = pattern.re.exec(sentence);
        if (!m) continue;
        seen.add(pattern.id);
        const correction =
          typeof pattern.correction === "function" ? pattern.correction(m) : pattern.correction;
        found.push({ pattern, userSentence: sentence.trim(), matchedText: m[0], correction });
      }
    }
  }
  return found;
}

/**
 * Deterministic review from the transcript alone. Runs for EVERY backend;
 * with EchoLLM this IS the review the server returns.
 */
export function extractReviewHeuristic(transcript: ChatMessage[], cfg: ExtractionConfig): Review {
  const userTurns = transcript.filter((t) => t.role === "user").map((t) => t.content);
  if (userTurns.length === 0) {
    return {
      vocabulary: [],
      grammar: [],
      summary: "No learner speech was recorded this session, so there is nothing to review.",
    };
  }

  const mistakes = detectMistakes(transcript, cfg.targetLanguage);
  const stopwords = stopwordsFor(cfg.targetLanguage);

  // --- vocabulary: mistake words first (SPEC demo: the review must include words
  // the learner struggled with, shown with their own sentence), then most-used
  // content words.
  const vocabulary: VocabItem[] = [];
  const coveredTokens = new Set<string>();
  for (const m of mistakes) {
    const headword = m.correction.replace(/\(e?\)/g, "").trim();
    for (const t of tokenize(headword)) coveredTokens.add(t);
    for (const t of tokenize(m.matchedText)) coveredTokens.add(t);
    vocabulary.push({
      word: headword,
      example: m.userSentence,
      note: m.pattern.vocabNote ?? m.pattern.point,
    });
    if (vocabulary.length >= 4) break; // keep room for usage words, max 6 total below
  }

  // frequency-ranked content words from learner turns
  const freq = new Map<string, { count: number; firstIdx: number }>();
  userTurns.forEach((turn, turnIdx) => {
    for (const token of tokenize(turn)) {
      if (stopwords.has(token)) continue;
      if (coveredTokens.has(token)) continue; // don't list raw mistake tokens beside corrections
      const e = freq.get(token) ?? { count: 0, firstIdx: turnIdx };
      e.count += 1;
      freq.set(token, e);
    }
  });
  const ranked = [...freq.entries()].sort(
    (a, b) => b[1].count - a[1].count || b[0].length - a[0].length || a[1].firstIdx - b[1].firstIdx,
  );
  for (const [token] of ranked) {
    if (vocabulary.length >= 6) break;
    const example = findExampleSentence(userTurns, token);
    if (!example) continue;
    vocabulary.push({ word: token, example });
  }

  // --- grammar: 1-2 points tied to OBSERVED mistakes only; empty if none.
  // `mistakeId` comes straight off the table pattern, so the identity is the same
  // string every time this rule fires — that is what makes cross-session counting
  // (issue #2) an exact lookup instead of a guess.
  const grammar: GrammarItem[] = mistakes.slice(0, 2).map((m) => ({
    mistakeId: m.pattern.id,
    point: m.pattern.point,
    example: m.userSentence,
    correction: m.correction,
    explanation: m.pattern.explanation,
  }));

  // --- summary: describes only what is actually in the transcript.
  const topics = ranked
    .slice(0, 3)
    .map(([w]) => w)
    .join(", ");
  const summary =
    `You practiced ${languageName(cfg.targetLanguage)} talking about: ${topics || "your day"}. ` +
    `This review keeps ${vocabulary.length} word${vocabulary.length === 1 ? "" : "s"} you used ` +
    (grammar.length > 0
      ? `and ${grammar.length} grammar point${grammar.length === 1 ? "" : "s"} from mistakes in this session.`
      : `and found no grammar mistakes worth flagging this session.`);

  return { vocabulary, grammar, summary };
}

// --------------------------------------------------------------- LLM path

/** Lenient JSON-object extraction (tolerates code fences / chatter). */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
}

/**
 * Re-source an example from the transcript: find the learner turn containing it
 * (folded containment) and return the transcript's OWN wording. Null = the model
 * invented or paraphrased it → the item must be dropped.
 */
export function ressourceExample(candidate: string, userTurns: string[]): string | null {
  const foldedCandidate = fold(candidate);
  if (!foldedCandidate) return null;
  // Prefer full-sentence matches: the learner's own SENTENCE is the review unit.
  for (const turn of userTurns) {
    for (const sentence of splitSentences(turn)) {
      if (fold(sentence) === foldedCandidate) return sentence.trim();
    }
  }
  // Fall back to span containment; re-slice from the ORIGINAL turn so the
  // transcript's own casing/wording is authoritative, never the model's.
  for (const turn of userTurns) {
    const foldedTurn = fold(turn);
    const idx = foldedTurn.indexOf(foldedCandidate);
    if (idx !== -1) {
      // fold() only changes case/quotes/whitespace-runs; slicing the original by
      // the same length is safe enough for display, then trim.
      return turn.slice(idx, idx + candidate.length).trim() || candidate;
    }
  }
  return null;
}

export interface ValidatedLLMReview {
  review: Review;
  dropped: string[]; // validation rejections, for logging/tests
}

/** Validate a parsed LLM review against the transcript. Examples are re-sourced. */
export function validateLLMReview(raw: Record<string, unknown>, userTurns: string[]): ValidatedLLMReview {
  const dropped: string[] = [];
  const vocabulary: VocabItem[] = [];
  for (const item of Array.isArray(raw.vocabulary) ? raw.vocabulary : []) {
    const it = item as Record<string, unknown>;
    const word = String(it.word ?? "").trim();
    const exampleRaw = String(it.example ?? "");
    if (!word) {
      dropped.push("vocab item without word");
      continue;
    }
    // headword may be the corrected form (not verbatim in transcript) — fine;
    // the EXAMPLE must be verbatim.
    const example = ressourceExample(exampleRaw, userTurns);
    if (!example) {
      dropped.push(`vocab example not verbatim in transcript: "${exampleRaw.slice(0, 60)}"`);
      continue;
    }
    vocabulary.push({ word, example, note: it.note ? String(it.note) : undefined });
  }
  const grammar: GrammarItem[] = [];
  for (const item of Array.isArray(raw.grammar) ? raw.grammar : []) {
    const it = item as Record<string, unknown>;
    const point = String(it.point ?? "").trim();
    const correction = String(it.correction ?? "").trim();
    const example = ressourceExample(String(it.example ?? ""), userTurns);
    if (!point || !correction) {
      dropped.push("grammar item missing point/correction");
      continue;
    }
    if (!example) {
      dropped.push("grammar example not verbatim in transcript");
      continue;
    }
    grammar.push({
      point,
      example,
      correction,
      explanation: String(it.explanation ?? "").trim() || correction,
    });
  }
  const summary = String(raw.summary ?? "").trim();
  return {
    review: { vocabulary: vocabulary.slice(0, 6), grammar: grammar.slice(0, 2), summary },
    dropped,
  };
}

/**
 * When validated LLM grammar is spliced onto an otherwise heuristic review, the
 * heuristic summary's "no grammar mistakes" clause would contradict the panel —
 * swap just that clause, keeping the (transcript-derived) topic words intact.
 */
export function spliceGrammarSummary(summary: string, grammarCount: number): string {
  const clause =
    `and ${grammarCount} grammar point${grammarCount === 1 ? "" : "s"} ` +
    "from mistakes in this session (flagged by the review model).";
  return summary.replace(/and found no grammar mistakes worth flagging this session\.$/, clause);
}

/**
 * Full extraction entry point used by the end_session tool.
 * With EchoLLM (or when the LLM pass fails validation) the heuristic path
 * decides; with Proxy/Bedrock the LLM pass enhances and every item is validated
 * against the transcript before it is kept.
 *
 * A3 routing rule (FR grammar-gap fix): when the heuristics found ZERO grammar
 * items, LLM-proposed grammar that survives verbatim validation is KEPT even if
 * the rest of the LLM review fell back — an empty heuristic table must not veto
 * a mistake the model demonstrably observed in the transcript.
 */
export async function extractReview(
  transcript: ChatMessage[],
  cfg: ExtractionConfig,
  llm?: LLM,
): Promise<{ review: Review; path: "heuristic" | "llm" }> {
  const heuristic = extractReviewHeuristic(transcript, cfg);
  if (!llm || llm.name === "echo") return { review: heuristic, path: "heuristic" };

  try {
    const transcriptText = transcript
      .map((t) => `${t.role === "user" ? "USER" : "SALA"}: ${t.content}`)
      .join("\n");
    const ask = () =>
      llm.invoke("review", reviewSystemPrompt(cfg), [
        { role: "user", content: `TRANSCRIPT:\n${transcriptText}` },
      ]);
    let raw = (await ask()).trim();
    let parsed = raw ? extractJsonObject(raw) : null;
    if (!parsed) {
      // The chat path already guards this: our proxy occasionally answers 200 with
      // empty content (observed 2026-10-20), and the review pass is the same call
      // shape. Without a retry the money shot silently degrades to the heuristic
      // table — which is what happened to a German session on 2026-10-22 with no
      // log line to explain it. One retry, then say out loud why we fell back.
      console.warn(`[review] no parseable LLM review for ${cfg.targetLanguage}, retrying once`);
      raw = (await ask()).trim();
      parsed = raw ? extractJsonObject(raw) : null;
    }
    if (!parsed) {
      console.warn(`[review] → heuristic for ${cfg.targetLanguage}: LLM returned nothing parseable twice`);
      return { review: heuristic, path: "heuristic" };
    }
    const userTurns = transcript.filter((t) => t.role === "user").map((t) => t.content);
    const { review, dropped } = validateLLMReview(parsed, userTurns);
    if (dropped.length > 0) {
      console.warn(`[review] dropped ${dropped.length} unvalidated LLM item(s):`, dropped);
    }
    // LLM output must beat the floor the heuristics set, else fall back.
    if (review.vocabulary.length === 0) {
      // The model's vocab failed verbatim validation — but its validated GRAMMAR
      // must not be thrown away with it. Heuristic tables are thin outside EN;
      // dropping LLM grammar here was the A2 FR regression (a session with real
      // tense mistakes came back with grammar: []). Splice validated grammar onto
      // the heuristic review (whose vocab is verbatim by construction).
      if (heuristic.grammar.length === 0 && review.grammar.length > 0) {
        return {
          review: {
            ...heuristic,
            grammar: review.grammar.slice(0, 2),
            summary:
              review.summary.trim() || spliceGrammarSummary(heuristic.summary, review.grammar.length),
          },
          path: "llm",
        };
      }
      console.warn(
        `[review] → heuristic for ${cfg.targetLanguage}: every LLM vocab example failed verbatim validation ` +
          `(${dropped.length} dropped) and the heuristics already found grammar`,
      );
      return { review: heuristic, path: "heuristic" };
    }
    if (review.grammar.length === 0 && heuristic.grammar.length > 0) {
      // never let the model talk us out of a mistake we actually observed
      review.grammar = heuristic.grammar.slice(0, 2);
    }
    // ...and the reverse floor: if heuristics observed nothing but the model
    // returned validated grammar, the LLM review already carries it (validated
    // examples only), so nothing extra to do here.
    if (!review.summary) review.summary = heuristic.summary;
    return { review, path: "llm" };
  } catch (err) {
    console.warn("[review] LLM pass failed, using heuristic:", err instanceof Error ? err.message : err);
    return { review: heuristic, path: "heuristic" };
  }
}
