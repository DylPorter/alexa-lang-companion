/**
 * Unit tests for review extraction (SPEC A1 acceptance): fixture conversations
 * in TWO languages — English ESL + French — proving extraction is
 * language-agnostic and every review item quotes the learner's OWN sentences.
 */
import { describe, expect, it } from "vitest";
import {
  detectMistakes,
  extractJsonObject,
  extractReview,
  extractReviewHeuristic,
  ressourceExample,
  validateLLMReview,
} from "../src/review/extract.js";
import { EchoLLM } from "../src/llm/echo.js";
import type { LLM, ChatMessage } from "../src/llm/types.js";
import {
  ESL_ENGLISH_FIXTURE,
  FRENCH_FIXTURE,
  userSentences,
} from "./fixtures/conversations.js";

const CFG_EN = { targetLanguage: "en", nativeLanguage: "en" };
const CFG_FR = { targetLanguage: "fr", nativeLanguage: "en" };

function expectExamplesVerbatim(review: ReturnType<typeof extractReviewHeuristic>, turns: string[]) {
  for (const item of [...review.vocabulary, ...review.grammar]) {
    expect(
      turns.some((t) => t.includes(item.example)),
      `example not verbatim in any learner turn: "${item.example}"`,
    ).toBe(true);
  }
}

describe("English ESL fixture — heuristic extraction", () => {
  const turns = userSentences(ESL_ENGLISH_FIXTURE);
  const review = extractReviewHeuristic(ESL_ENGLISH_FIXTURE, CFG_EN);

  it("detects the fixture's actual mistakes (tense, article, word order, preposition, agreement)", () => {
    const ids = detectMistakes(ESL_ENGLISH_FIXTURE, "en").map((m) => m.pattern.id);
    expect(ids).toEqual([
      "en-past-tense-adverb",
      "en-article-place",
      "en-am-agree",
      "en-depend-prep",
      "en-third-person-s",
    ]);
  });

  it("returns 4-6 vocabulary items, every example the learner's own sentence", () => {
    expect(review.vocabulary.length).toBeGreaterThanOrEqual(4);
    expect(review.vocabulary.length).toBeLessThanOrEqual(6);
    expectExamplesVerbatim(review, turns);
  });

  it("includes the words the learner struggled with, with the corrected form as headword", () => {
    const words = review.vocabulary.map((v) => v.word.toLowerCase());
    expect(words).toContain("i went");
    expect(words).toContain("the climbing wall");
    expect(words).toContain("i agree");
    expect(words).toContain("depend on");
    // the struggled-with vocab item shows the learner's ORIGINAL (wrong) sentence
    const went = review.vocabulary.find((v) => v.word.toLowerCase() === "i went");
    expect(went?.example).toBe("Yesterday I go to climbing wall with my friend Daniel.");
  });

  it("returns 1-2 grammar points tied to observed mistakes only", () => {
    expect(review.grammar.length).toBeGreaterThanOrEqual(1);
    expect(review.grammar.length).toBeLessThanOrEqual(2);
    const corrections = review.grammar.map((g) => g.correction.toLowerCase());
    expect(corrections).toContain("i went"); // tense
    expect(corrections).toContain("the climbing wall"); // article
    for (const g of review.grammar) {
      expect(turns.some((t) => t.includes(g.example))).toBe(true);
      expect(g.explanation.length).toBeGreaterThan(10);
    }
  });

  it("summary describes only topics actually present", () => {
    expect(review.summary.toLowerCase()).toContain("daniel");
    expect(review.summary).toMatch(/grammar point/i);
  });
});

describe("French fixture — same extractor, different table (language-agnostic proof)", () => {
  const turns = userSentences(FRENCH_FIXTURE);
  const review = extractReviewHeuristic(FRENCH_FIXTURE, CFG_FR);

  it("detects the French fixture's actual mistakes", () => {
    const ids = detectMistakes(FRENCH_FIXTURE, "fr").map((m) => m.pattern.id);
    expect(ids).toEqual([
      "fr-passe-compose-aller",
      "fr-beaucoup-de",
      "fr-age-avoir",
      "fr-voiture-gender",
    ]);
  });

  it("quotes the learner's own French sentences in every item", () => {
    expect(review.vocabulary.length).toBeGreaterThanOrEqual(4);
    expect(review.vocabulary.length).toBeLessThanOrEqual(6);
    expectExamplesVerbatim(review, turns);
  });

  it("grammar points come from the French table", () => {
    const corrections = review.grammar.map((g) => g.correction.toLowerCase());
    expect(corrections).toContain("je suis allé(e)");
    expect(corrections).toContain("beaucoup de");
    expect(review.grammar[0].example).toBe("Hier j'ai allé au cinéma avec ma sœur.");
  });

  it("resolves function corrections (j'ai 22 ans) from match groups", () => {
    const age = review.vocabulary.find((v) => v.word.includes("22"));
    expect(age?.word).toBe("j'ai 22 ans");
    expect(age?.example).toContain("Je suis 22 ans");
  });
});

describe("honesty edge cases", () => {
  it("empty transcript → empty review, honest summary, no fabrication", () => {
    const review = extractReviewHeuristic([], CFG_EN);
    expect(review.vocabulary).toEqual([]);
    expect(review.grammar).toEqual([]);
    expect(review.summary).toMatch(/nothing to review/i);
  });

  it("clean transcript → no grammar points invented", () => {
    const clean: ChatMessage[] = [
      { role: "user", content: "Today I walked to the park and read a book about birds." },
      { role: "assistant", content: "Sounds peaceful! What birds did you read about?" },
      { role: "user", content: "Sparrows and owls. I liked the chapter about owls." },
    ];
    const review = extractReviewHeuristic(clean, CFG_EN);
    expect(review.grammar).toEqual([]);
    expect(review.summary).toMatch(/no grammar mistakes/i);
    expect(review.vocabulary.length).toBeGreaterThan(0);
    expectExamplesVerbatim(review, userSentences(clean));
  });

  it("language without a mistake table → vocab still extracted, grammar honestly empty", () => {
    const vi: ChatMessage[] = [
      { role: "user", content: "Hôm nay tôi đi chợ và mua nhiều rau tươi." },
      { role: "assistant", content: "Nghe hay đó! Bạn nấu món gì?" },
    ];
    const review = extractReviewHeuristic(vi, { targetLanguage: "vi", nativeLanguage: "en" });
    expect(review.grammar).toEqual([]);
    expect(review.vocabulary.length).toBeGreaterThan(0);
  });
});

describe("LLM enhancement path — validation is the contract", () => {
  const turns = userSentences(ESL_ENGLISH_FIXTURE);

  it("validateLLMReview drops invented examples and re-sources drifted ones", () => {
    const raw = {
      vocabulary: [
        // verbatim → kept, re-sourced to the transcript's own wording
        { word: "climbing", example: "Yesterday I go to climbing wall with my friend Daniel." },
        // fabricated → dropped
        { word: "bouldering", example: "We bouldered for three hours." },
        // case-drifted → kept, re-sourced verbatim from transcript
        { word: "daniel", example: "yesterday i GO to climbing wall with my friend DANIEL." },
      ],
      grammar: [
        {
          point: "Past tense",
          example: "Yesterday I go to climbing wall with my friend Daniel.",
          correction: "I went",
          explanation: "Yesterday requires the past tense.",
        },
        { point: "Invented", example: "She dont likes it", correction: "doesn't like", explanation: "x" },
      ],
      summary: "You talked about climbing with Daniel.",
    };
    const { review, dropped } = validateLLMReview(raw, turns);
    expect(dropped.length).toBe(2); // bouldering + invented grammar
    expect(review.vocabulary.map((v) => v.word)).toEqual(["climbing", "daniel"]);
    expect(review.vocabulary[1].example).toBe(
      "Yesterday I go to climbing wall with my friend Daniel.",
    ); // the TRANSCRIPT's own sentence wins, not the model's casing
    expect(review.grammar.length).toBe(1);
    expect(review.summary).toBe("You talked about climbing with Daniel.");
  });

  it("extractReview falls back to heuristic when the LLM emits garbage", async () => {
    const broken: LLM = {
      name: "proxy",
      async invoke() {
        return "sorry, I cannot help with that";
      },
    };
    const { review, path } = await extractReview(ESL_ENGLISH_FIXTURE, CFG_EN, broken);
    expect(path).toBe("heuristic");
    expect(review.grammar.length).toBeGreaterThan(0);
  });

  it("extractReview never lets the LLM talk us out of an observed mistake", async () => {
    const noGrammar: LLM = {
      name: "bedrock",
      async invoke() {
        return JSON.stringify({
          vocabulary: [
            { word: "climbing", example: "Yesterday I go to climbing wall with my friend Daniel." },
          ],
          grammar: [],
          summary: "A short climbing chat.",
        });
      },
    };
    const { review, path } = await extractReview(ESL_ENGLISH_FIXTURE, CFG_EN, noGrammar);
    expect(path).toBe("llm");
    // heuristic-detected mistakes are backfilled even though the model saw none
    expect(review.grammar.length).toBeGreaterThan(0);
    expect(review.grammar.map((g) => g.correction.toLowerCase())).toContain("i went");
  });

  it("extractReview with EchoLLM uses the heuristic path (offline determinism)", async () => {
    const { review, path } = await extractReview(ESL_ENGLISH_FIXTURE, CFG_EN, new EchoLLM());
    expect(path).toBe("heuristic");
    expect(review.vocabulary.length).toBeGreaterThanOrEqual(4);
    expectExamplesVerbatim(review, turns);
  });

  it("ressourceExample returns null for paraphrase", () => {
    expect(ressourceExample("We needed more practice sessions", turns)).toBeNull();
    expect(
      ressourceExample("we need more practice", turns)?.toLowerCase(),
    ).toContain("we need more practice");
  });

  it("extractJsonObject tolerates fences and chatter", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('Here you go: {"a":1} — enjoy!')).toEqual({ a: 1 });
    expect(extractJsonObject("no json here")).toBeNull();
  });
});
