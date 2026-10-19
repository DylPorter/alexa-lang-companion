/**
 * Fixture transcripts for review-extraction tests (SPEC A1: two languages —
 * an English ESL learner transcript with article/tense/preposition/word-order
 * mistakes + a non-English learner transcript proving the extraction is
 * language-agnostic). Review items in the tests must derive from THESE actual
 * words and mistakes, quoting the learner's own sentences.
 */
import { ChatMessage } from "../../src/llm/types.js";

/**
 * English ESL learner session. Real mistake shapes (SPEC demo flow uses
 * "Yesterday I go to climbing wall"):
 *  - tense:      "Yesterday I go …"            → I went
 *  - article:    "to climbing wall"            → to the climbing wall
 *  - word order: "I am agree"                 → I agree
 *  - preposition:"depend of the weather"      → depend on
 *  - agreement:  "He work out every day"      → He works out
 * Clean sentences carry the topic vocabulary (Daniel, climbing, project…).
 */
export const ESL_ENGLISH_FIXTURE: ChatMessage[] = [
  { role: "user", content: "Hi Sala! Yesterday I go to climbing wall with my friend Daniel." },
  { role: "assistant", content: "You WENT to the climbing wall? Nice — how did it go?" },
  { role: "user", content: "It was very difficult but I am agree with Daniel: we need more practice." },
  { role: "assistant", content: "Practice is the fun part! How often can you two go?" },
  { role: "user", content: "Next time depend of the weather, maybe Saturday morning." },
  { role: "assistant", content: "Saturday sounds good. Is Daniel your climbing partner every week?" },
  { role: "user", content: "Yes! Daniel is very strong. He work out every day before work." },
  { role: "assistant", content: "Every day? That explains the climbing strength!" },
  { role: "user", content: "Today I am tired. I finished a big project and slept only five hours." },
  { role: "assistant", content: "Five hours is not much. Rest tonight — the wall will wait for you." },
];

/**
 * French learner session (Dylan's own learning story; second fixture language).
 * Mistake shapes:
 *  - auxiliary:  "Hier j'ai allé au cinéma"    → je suis allé
 *  - preposition:"beaucoup des films"         → beaucoup de films
 *  - idiom:      "Je suis 22 ans"             → j'ai 22 ans
 *  - gender:     "le voiture rouge"           → la voiture
 */
export const FRENCH_FIXTURE: ChatMessage[] = [
  { role: "user", content: "Salut Sala ! Hier j'ai allé au cinéma avec ma sœur." },
  { role: "assistant", content: "Ah, tu es allé au cinéma ! Qu'est-ce que vous avez vu ?" },
  { role: "user", content: "Nous avons regardé beaucoup des films cette semaine, mais celui-là était le meilleur." },
  { role: "assistant", content: "Beaucoup de films en une semaine ! C'était quel genre ?" },
  { role: "user", content: "Un film policier. Je suis 22 ans et j'aime les histoires mystérieuses." },
  { role: "assistant", content: "Les histoires mystérieuses, c'est le meilleur genre. Tu regardes souvent des films le soir ?" },
  { role: "user", content: "Oui ! Ma sœur conduit le voiture rouge en ville et nous allons au cinéma ensemble." },
  { role: "assistant", content: "Une belle soirée entre frère et sœur, alors !" },
];

/** Every learner (user) sentence across a fixture — the verbatim source of truth. */
export function userSentences(transcript: ChatMessage[]): string[] {
  return transcript.filter((t) => t.role === "user").map((t) => t.content);
}
