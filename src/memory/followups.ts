/**
 * Anticipated-event detection — the cross-session follow-up (cross-session follow-ups).
 *
 * The claim: the learner says "I'm stressed about my interview" on Tuesday, and on
 * Thursday Sala opens the next session with "so — how did the interview go?". For
 * that to be a *memory* and not a trick, three things have to hold, and all three
 * are decided here, in code a test can pin down:
 *
 * 1. **The learner's own words.** The stored row keeps the full turn verbatim, so
 *    everything Sala can later say about your life is a sentence you actually said.
 *    No paraphrase, no model-written summary of "what you seemed worried about".
 * 2. **It must be an event, not a mood.** A known event noun has to be in the turn
 *    ("interview", "entretien", "Prüfung"…). A stress word alone is not an event —
 *    "I'm stressed about traffic" must never become a question about traffic.
 * 3. **It must be something that can have happened by now.** Either a feeling cue
 *    ("nervous about / scared about / dreading"), or a scheduled shape: a
 *    present/future verb *with* a time marker ("I have an interview on Friday").
 *    The time marker is what keeps "I have an interview question" out of the table.
 *    Any past marker vetoes the whole turn ("had", "yesterday", "already", "it went").
 *
 * The veto is deliberately one-directional: a false veto costs one missed question,
 * a false ask makes Sala claim knowledge of an event that was already over — the
 * same asymmetry `validateLLMReview` applies to verbatim examples, resolved the same
 * way. The tables are therefore kept small and verified, not exhaustive.
 *
 * Cue tables exist for the four languages `src/review/extract.ts` carries mistake
 * tables for. Any other language produces no seeds and Sala stays silent — an
 * unverified phrase list is not a memory feature. Matching folds case, quotes and
 * accents (same normalisation as `mistakeSlug`), so every table entry is lowercase
 * ASCII: "entretien", "prufung", "expose", "estres".
 */
import { fold } from "../review/extract.js";

/** A follow-up as it leaves the detector, before it becomes a stored row. */
export interface FollowUpSeed {
  /** Canonical, language-neutral key — the dedupe handle ("interview"). */
  topic: string;
  /** The learner's own turn, verbatim. */
  quote: string;
  /** `created_at` of the transcript row the quote came from (ISO). */
  saidAt: string;
  /** Language tag of that turn — the quote is read back in the language it came in. */
  language: string;
}

/** One learner turn with the timestamp stored alongside it. */
export interface LearnerTurn {
  text: string;
  at: string;
  language?: string;
}

/** Cap per session, so one anxious conversation cannot flood the next opener. */
export const MAX_FOLLOWUPS_PER_SESSION = 3;

/** Event nouns, grouped under the canonical topic they belong to. */
const TOPIC_NOUNS: Record<string, Array<[topic: string, nouns: string[]]>> = {
  en: [
    ["interview", ["interview", "interviews"]],
    ["presentation", ["presentation", "presentations", "pitch", "pitches", "talk"]],
    ["exam", ["exam", "exams", "test", "tests"]],
    ["audition", ["audition", "auditions"]],
    ["competition", ["competition", "competitions", "contest", "finals", "marathon", "race"]],
  ],
  fr: [
    ["interview", ["entretien", "entretiens"]],
    ["presentation", ["expose", "exposes", "presentation", "presentations", "oral"]],
    ["exam", ["examen", "examens", "epreuve", "epreuves", "partiel", "controle"]],
    ["audition", ["audition", "auditions"]],
    ["competition", ["competition", "competitions", "concours", "marathon", "course"]],
  ],
  de: [
    ["interview", ["vorstellungsgesprach", "vorstellungsgesprache", "interview"]],
    ["presentation", ["presentation", "prasentation", "prasentationen", "vortrag"]],
    ["exam", ["prufung", "prufungen", "examen", "test", "klausur"]],
    ["audition", ["vorsingen", "vorsprechen", "audition", "casting"]],
    ["competition", ["wettbewerb", "wettkampf", "marathon", "rennen"]],
  ],
  es: [
    ["interview", ["entrevista", "entrevistas"]],
    ["presentation", ["presentacion", "presentaciones", "exposicion", "exposiciones"]],
    ["exam", ["examen", "examenes", "prueba", "pruebas"]],
    ["audition", ["audicion", "audiciones", "casting"]],
    ["competition", ["competicion", "competiciones", "concurso", "oposicion", "maraton", "carrera"]],
  ],
};

/**
 * "Something is coming and I dread it." Enough on its own, no time marker needed.
 * Matched as STEMS with a left word-boundary only, because inflection hangs off the
 * end: `stres` covers stressed / stressée (which folds to "stressée"→"stressee") /
 * estrés, `worr` covers worry / worried / worrying, `nerv` covers nervous / nerveuse /
 * nervös. What that buys in reach costs in negation-blindness: "I'm not scared of the
 * interview" seeds a row. Sala then asks, the learner corrects it, and the prompt tells
 * it to take the question back — a missed nuance, not a fabricated memory.
 */
const STRESS_CUES: Record<string, string[]> = {
  en: ["stress", "nerv", "worr", "anxious", "scared", "terrifi", "dread", "freak"],
  fr: ["stres", "nerv", "angoiss", "inquiet", "peur", "apprehend", "craint"],
  de: ["stress", "gestresst", "nerv", "angst", "sorg", "bange", "furcht"],
  es: ["estres", "nervios", "nerv", "preocup", "ansios", "asust", "miedo"],
};

/** Present/future scheduling. Only counts together with a time marker. */
const HAVE_CUES: Record<string, string[]> = {
  en: ["have", "has", "got", "having", "booked", "scheduled", "going to", "about to"],
  fr: ["ai", "a", "avons", "ont", "vais", "prevu", "planifie"],
  de: ["habe", "hat", "haben", "plane", "geplant", "werde"],
  es: ["tengo", "tiene", "tenemos", "tienen", "voy a", "va a", "programado", "planeado"],
};

/** When it is happening. Required for the scheduled shape, ignored for the feeling one. */
const TIME_MARKERS: Record<string, string[]> = {
  en: ["today", "tonight", "tomorrow", "soon", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "next week", "next month", "this week", "this month", "this afternoon", "this evening", "this weekend"],
  fr: ["aujourdhui", "demain", "bientot", "ce soir", "cet apres-midi", "cette semaine", "la semaine prochaine", "le mois prochain", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"],
  de: ["heute", "morgen", "bald", "diese woche", "nachste woche", "nachsten monat", "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag"],
  es: ["hoy", "manana", "pronto", "esta noche", "esta tarde", "esta semana", "la semana proxima", "el mes proximo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"],
};

/** Anything that says "this is behind us" vetoes the turn. */
const PAST_MARKERS: Record<string, string[]> = {
  en: ["yesterday", "last week", "last month", "last night", "ago", "already", "had", "have had", "went", "it went", "finished", "done", "over"],
  fr: ["hier", "avant-hier", "la semaine derniere", "le mois dernier", "deja", "passe", "ai eu", "c'etait", "fini", "termine"],
  de: ["gestern", "letzte woche", "letzten monat", "vor einer woche", "schon", "hatte", "war", "vorbei", "fertig", "erledigt"],
  es: ["ayer", "la semana pasada", "el mes pasado", "ya", "tuve", "estuvo", "pasado", "terminado", "acabado"],
};

/** Case-, quote- and accent-insensitive form. For matching only, never for display. */
function matchFold(text: string): string {
  return fold(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .normalize("NFC");
}

const reCache = new Map<string, RegExp>();

/** Whole-phrase match, so "test" never fires inside "latest" and "ai" not in "mais". */
function phraseRe(phrase: string): RegExp {
  let re = reCache.get(phrase);
  if (!re) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "u");
    reCache.set(phrase, re);
  }
  return re;
}

function hasAny(folded: string, phrases: string[] | undefined): boolean {
  if (!phrases) return false;
  return phrases.some((p) => phraseRe(p).test(folded));
}

const stemCache = new Map<string, RegExp>();

/**
 * Stem match: a word boundary on the left, nothing on the right — so the cue may be
 * the beginning of an inflected word (`stres` → "stressée", `worr` → "worried"). Used
 * ONLY for the feeling cues, where reach matters and a false positive costs a question
 * the learner can wave off; nouns, time markers and the past veto stay exact.
 */
function hasStem(folded: string, stems: string[] | undefined): boolean {
  if (!stems) return false;
  return stems.some((stem) => {
    let re = stemCache.get(stem);
    if (!re) {
      re = new RegExp(`(^|[^\\p{L}\\p{N}])${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u");
      stemCache.set(stem, re);
    }
    return re.test(folded);
  });
}

/** Languages this module has verified cue tables for. Everything else stays silent. */
export function supportsFollowUps(lang: string): boolean {
  return lang.toLowerCase().slice(0, 2) in TOPIC_NOUNS;
}

/**
 * Scan the learner's own turns for events they are waiting for. Transcript order is
 * kept (the first turn that mentions a topic owns that topic's row); the store is
 * what later orders by `said_at`. Assistant turns are never passed here — Sala must
 * not end up asking about an event it invented itself.
 */
export function detectFollowUps(turns: LearnerTurn[], lang: string): FollowUpSeed[] {
  const l = lang.toLowerCase().slice(0, 2);
  const nouns = TOPIC_NOUNS[l];
  if (!nouns) return [];

  const out: FollowUpSeed[] = [];
  const seen = new Set<string>();
  for (const turn of turns) {
    const folded = matchFold(turn.text ?? "");
    if (!folded) continue;
    if (hasAny(folded, PAST_MARKERS[l])) continue; // one past marker vetoes the whole turn
    for (const [topic, words] of nouns) {
      if (seen.has(topic)) continue;
      if (!hasAny(folded, words)) continue;
      const upcoming =
        hasStem(folded, STRESS_CUES[l]) ||
        (hasAny(folded, HAVE_CUES[l]) && hasAny(folded, TIME_MARKERS[l]));
      if (!upcoming) continue;
      seen.add(topic);
      out.push({ topic, quote: turn.text.trim(), saidAt: turn.at, language: turn.language || l });
      if (out.length >= MAX_FOLLOWUPS_PER_SESSION) return out;
    }
  }
  return out;
}
