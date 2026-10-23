/**
 * The spoken language switch, in isolation.
 *
 * These two lists are the product decision written down as tests: a request to change
 * language must work in any of the languages Sala teaches, phrased in the language the
 * learner is PRACTISING (not their L1), and a mere MENTION of a language — which is what
 * half of a language-practice conversation consists of — must never hijack the session.
 * Every case here failed at some point during development; the false positives are the
 * expensive ones, so they are asserted as strictly as the positives.
 */
import { describe, expect, it } from "vitest";
import {
  KNOWN_LANGUAGE_CODES,
  detectLanguageSwitch,
  languageName,
  normalizeLanguageCode,
} from "../src/persona/languages.js";

describe("detectLanguageSwitch — requests that must switch", () => {
  const cases: Array<[string, string]> = [
    // English frames
    ["let's speak French", "fr"],
    ["Let's do it in Italian", "it"],
    ["can we switch to German", "de"],
    ["could you speak Japanese", "ja"],
    ["switch to Spanish please", "es"],
    ["speak Portuguese instead", "pt"],
    ["reply in Chinese now", "zh"],
    ["translate that to Korean", "ko"],
    ["let's practice Vietnamese", "vi"],
    ["French please", "fr"],
    ["only English please", "en"],
    ["could we continue in French please", "fr"],
    ["I want to speak Spanish", "es"],
    ["from now on, Japanese", "ja"],
    // A request phrased in the language being practised
    ["parlons français", "fr"],
    ["passe au allemand", "de"],
    ["lass uns deutsch sprechen", "de"],
    ["hablemos español", "es"],
    ["cambia a italiano", "it"],
    ["habla en coreano por favor", "ko"],
    ["nur Deutsch bitte", "de"],
    // A code, not a name — and the code is also an English word shape, so it needs the verb
    ["let's switch to pt", "pt"],
  ];

  for (const [message, code] of cases) {
    it(`${JSON.stringify(message)} → ${code}`, () => {
      const got = detectLanguageSwitch(message);
      expect(got?.code).toBe(code);
      expect(got?.matched.length).toBeGreaterThan(0);
    });
  }
});

describe("detectLanguageSwitch — mentions that must NOT switch", () => {
  const messages = [
    "I speak French at work",
    "I speak a little French",
    "my friend speaks German every day",
    "I usually practice Vietnamese on Sundays",
    "we spoke Spanish at home yesterday",
    "I want to practice my French later",
    "she knows Italian better than me",
    "j'ai appris l'espagnol à l'école",
    "I'm learning Japanese this semester",
    "I wrote an essay about Chinese food",
    "what's the word in Spanish?",
    "I don't know the word in French",
    "how do you say thank you in Korean",
    "tell me about Chinese New Year",
    "do you know Italian cooking",
    "my French is not very good",
    "German is hard",
    "Yesterday I go to climbing wall and I am very tire after",
    "I'm going to Paris next month",
  ];

  for (const message of messages) {
    it(`${JSON.stringify(message)} → no switch`, () => {
      expect(detectLanguageSwitch(message)).toBeNull();
    });
  }
});

describe("normalizeLanguageCode", () => {
  it("takes codes, regions and names", () => {
    expect(normalizeLanguageCode("fr")).toBe("fr");
    expect(normalizeLanguageCode("FR")).toBe("fr");
    expect(normalizeLanguageCode("de-DE")).toBe("de");
    expect(normalizeLanguageCode("French")).toBe("fr");
    expect(normalizeLanguageCode("français")).toBe("fr");
    expect(normalizeLanguageCode("español")).toBe("es");
    expect(normalizeLanguageCode("日本語")).toBe("ja");
  });

  it("returns null rather than guessing", () => {
    expect(normalizeLanguageCode("klingon")).toBeNull();
    expect(normalizeLanguageCode("")).toBeNull();
    expect(normalizeLanguageCode("  ")).toBeNull();
  });
});

describe("languageName", () => {
  it("degrades honestly for codes with no name", () => {
    expect(languageName("en")).toBe("English");
    expect(languageName("tlh")).toContain("tlh");
  });
});

it("every known code has a name", () => {
  for (const code of KNOWN_LANGUAGE_CODES) {
    expect(languageName(code)).not.toContain("code");
  }
});
