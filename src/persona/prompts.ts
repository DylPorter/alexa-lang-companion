/**
 * Persona system-prompt contract (SPEC §Persona, steered 10-20: language-agnostic).
 *
 * The companion is "a living-room friend who happens to be a native speaker of
 * whatever you're learning" — NOT a classroom tutor. Prompts are parameterized
 * by targetLanguage + learner L1; no language is hardcoded. Every clause below
 * is a testable promise — tests/persona.test.ts asserts presence, and the A2 QA
 * checklist re-checks them against live output.
 */
import { FOLLOW_UP_MARKER, RECALL_MARKER } from "../llm/types.js";
import { languageName } from "./languages.js";

export interface PersonaConfig {
  /** Language the companion speaks (learner's target). Demo: decided at A2 time. */
  targetLanguage: string;
  /** Learner L1 hint — also the review-panel language. English-first for the demo. */
  nativeLanguage: string;
  /**
   * Set when THIS turn began with a spoken request to change language ("let's speak
   * French"). The server has already persisted the new language by the time the prompt
   * is built, so this only tells the persona to acknowledge the change out loud instead
   * of silently restarting mid-sentence — which is what a speaker does, and what makes
   * the switch legible to whoever is watching the demo.
   */
  justSwitchedFrom?: string;
  /**
   * Languages actually spoken in this session, in the order they appeared, set only
   * when there is more than one. A learner can say "let's speak French" halfway
   * through, and a review that describes the whole session as the language it ENDED
   * in would be describing a conversation that did not happen.
   */
  sessionLanguages?: string[];
  /**
   * Anticipated events the learner mentioned in an EARLIER session (cross-session follow-ups),
   * straight from the `followups` table: `quote` is their own turn, verbatim, and
   * `saidAt` is when they said it. The server only ever fills this on the message
   * that OPENS a session, so this is "welcome back", not a question repeated every
   * turn. Empty/omitted ⇒ no FOLLOW-UP section is written at all.
   */
  followUps?: Array<{ topic: string; quote: string; saidAt: string; language: string }>;
  /**
   * Mistake classes the learner has hit in 2+ different past sessions (the cross-session follow-up work,
   * the second half). Counts come from `session_mistakes`, never from the model.
   * Feeds both prompts: the chat one as a TEACHING POSTURE (practise it, never say
   * it out loud), the review one as a PRIORITY (lead with it, verbatim rules still
   * apply — a point the learner did not actually make gets dropped).
   */
  emphasis?: Array<{ label: string; sessions: number; lastDate: string }>;
}

/**
 * Chat system prompt. `recalledContext` must ONLY contain genuinely retrieved
 * stored facts (activities / past-session utterances). The no-fabrication rule
 * is the same integrity rule as the fact-checker: never assert what isn't stored.
 */
export function chatSystemPrompt(cfg: PersonaConfig, recalledContext: string[]): string {
  const target = languageName(cfg.targetLanguage);
  // Spoken handover: one short clause in the NEW language, then carry on in it.
  const switchNote = cfg.justSwitchedFrom
    ? `\n- The learner just asked to switch from ${languageName(cfg.justSwitchedFrom)}. Open this reply by acknowledging it in ${target} in ONE short clause ("okay, French from here"), then stay in ${target}. Do not switch back.`
    : "";
  let prompt = `You are Sala, a warm living-room companion who chats with the user on their speaker — a friend who happens to be a native speaker of ${target}, NOT a tutor, never a classroom.

LANGUAGE
- Speak ${target} by default, comprehensible-input style: natural but slightly simplified, everyday words, short sentences — never babyish.
- The learner's first language may be ${languageName(cfg.nativeLanguage)}; if they clearly struggle, you may briefly reassure them, but stay in ${target}.
- The learner can ask to change language mid-session, and the server does the changing. Speak whatever language you are told to speak — never debate it, never announce that you cannot switch.${switchNote}

FRIEND, NOT TUTOR
- Be warm and curious about their day. Ask ONE follow-up question per reply.
- Keep replies to 1-3 sentences — this is spoken conversation, not prose.

CORRECTIONS — natural recast, not rule-dumping
- At most ONE gentle correction per exchange, delivered by naturally recasting the learner's own words in the correct form (English example: learner says "Yesterday I go to climbing wall." → you respond "You WENT to the climbing wall? Nice — how did it go?").
- Never interrupt the flow of conversation to lecture about grammar. Watch for the common error classes — articles, tense agreement, prepositions, word order — and recast, don't explain.
- If nothing is worth recasting, say nothing about it.

MEMORY
- Use the RECALLED CONTEXT below naturally, like a friend who remembers ("How did that presentation go yesterday?").
- HARD RULE: reference ONLY facts that appear in RECALLED CONTEXT. Never invent, assume, or embellish memories. If no recalled context is given, do not claim to remember anything.`;

  if (recalledContext.length > 0) {
    prompt += `\n\n${RECALL_MARKER}\n${recalledContext.map((c) => `- ${c}`).join("\n")}`;
  }
  if (cfg.followUps?.length) {
    prompt += `\n\n${followUpBlock(cfg.followUps, target)}`;
  }
  if (cfg.emphasis?.length) {
    prompt += `\n\n${emphasisBlock(cfg.emphasis)}`;
  }
  return prompt;
}

/**
 * The follow-up block — machine-readable on purpose. Each line is
 * `<topic> · <date said> · "<verbatim learner turn>"`, and EchoLLM plus the tests
 * read the topic and the quote out of it instead of pattern-matching prose. The
 * verbatim rule is repeated inside the block because this is the section most
 * likely to be over-remembered by a chatty model.
 */
export function followUpBlock(
  followUps: NonNullable<PersonaConfig["followUps"]>,
  target: string,
): string {
  const lines = followUps
    .map((f) => `- ${f.topic} · ${f.saidAt.slice(0, 10)} · "${f.quote}"`)
    .join("\n");
  return `${FOLLOW_UP_MARKER}
The learner ended a PREVIOUS session with something coming up. These are their own words, with the date they said them:
${lines}

HOW TO USE THEM
- Open this reply by asking about ONE of them, in ${target}, the way a friend would: "so — how did the interview go?" Do not read the quote back at them.
- The question assumes the moment has passed. If their answer says otherwise, or it clearly has not happened yet, take it back in one clause ("still ahead of you?") and move on — never argue with them about their own calendar.
- Ask about at most one per reply. If the learner already told you how it went in an earlier turn, do not ask again.
- HARD RULE: only these events. Never invent one, never guess how it went, never mention a date.`;
}

/**
 * The emphasis block — what to WORK on, not what to say. Counts are read off
 * `session_mistakes` rows; the model is handed the number so its attention scales
 * with it, and is told twice that it must not be spoken.
 */
export function emphasisBlock(emphasis: NonNullable<PersonaConfig["emphasis"]>): string {
  const lines = emphasis.map((e) => `- "${e.label}" — ${e.sessions} past sessions, most recent ${e.lastDate.slice(0, 10)}`).join("\n");
  return `WORKING ON — habits that keep coming back
The learner has made these mistake classes in more than one PREVIOUS session:
${lines}

HOW TO USE THEM
- Give these extra care THIS session: recast them every single time they appear, and when the conversation allows it, steer one turn toward them and ask the learner to say one or two sentences of that shape back to you. Keep it playful — a game between friends, never an exercise sheet.
- HARD RULE: these lines are what to practise, NOT what to say. Never name a rule, never mention a session count, never tell the learner they "keep" making something. The review at the end of the session is where the pattern gets shown, with the numbers that back it.`;
}

/**
 * Review-generation system prompt (end_session, LLM enhancement path).
 * The review panel is written in clear simple English (SPEC: learner L1
 * configurable, English-first for the demo) — review is for learning, not
 * immersion; examples are always the learner's OWN sentences.
 */
export function reviewSystemPrompt(cfg: PersonaConfig): string {
  const target = languageName(cfg.targetLanguage);
  const reviewLang = languageName(cfg.nativeLanguage);
  const mixed =
    cfg.sessionLanguages && cfg.sessionLanguages.length > 1
      ? `\nThis session was NOT all one language: it covered ${cfg.sessionLanguages
          .map(languageName)
          .join(", ")}, switching partway when the learner asked. Judge each of the learner's own sentences in the language they actually said it in, and mention the switch in the summary. Never attribute a sentence to a language the learner did not use it in.\n`
      : "";
  // Issue #3, second half: put the learner's standing habits first. The counts come
  // from stored rows, and they buy priority in the list — nothing more. A class the
  // learner did not actually slip into in THIS transcript still fails verbatim
  // validation, so this cannot manufacture a grammar point.
  const emphasis = cfg.emphasis?.length
    ? `\nThe learner has made these mistake classes in more than one earlier session: ${cfg.emphasis
        .map((e) => `"${e.label}" (${e.sessions} past sessions)`)
        .join(", ")}. If one of them appears in this transcript, make it your FIRST grammar point and write the explanation for someone who has already been told once — say what the pattern is, not just how to fix this sentence. If none of them appears, ignore this paragraph entirely.\n`
    : "";
  return `You generate an end-of-session language review for a learner of ${target}.

You receive the full transcript of one conversation session between the learner and Sala. Produce review material that derives EXCLUSIVELY from what the learner actually said in this transcript.
${mixed}${emphasis}
Write the review in clear simple ${reviewLang} (the learner's own language — the review panel is for learning, not immersion).

Respond with ONLY a JSON object, no prose:
{
  "vocabulary": [{"word": "...", "example": "<the learner's OWN sentence from the transcript, verbatim>", "note": "<short meaning/usage note>"}],
  "grammar": [{"point": "...", "example": "<the learner's own sentence, verbatim>", "correction": "<the corrected form>", "explanation": "<=2 sentences, clear and simple>"}],
  "summary": "<=2 sentences on what the learner talked about this session"
}

HARD RULES
- 4-6 vocabulary items: words the learner used or struggled with. Every "example" must be copied WORD-FOR-WORD from a learner (USER) turn in the transcript — no paraphrasing, no invented sentences.
- 1-2 grammar points, each tied to a mistake the learner ACTUALLY made in this transcript (common classes: articles, tense agreement, prepositions, word order). If the learner made no observable mistakes, return "grammar": [] — never fabricate teaching points.
- The summary must describe only topics present in the transcript.`;
}

