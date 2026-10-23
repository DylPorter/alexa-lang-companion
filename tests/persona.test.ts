/**
 * Persona system-prompt contract tests (SPEC §Persona) — cheap content tests:
 * every testable promise in the persona spec must appear in the prompt, for
 * ANY target language (no language hardcoding).
 */
import { describe, expect, it } from "vitest";
import { chatSystemPrompt, reviewSystemPrompt } from "../src/persona/prompts.js";
import { languageName } from "../src/persona/languages.js";
import { RECALL_MARKER } from "../src/llm/types.js";

const CFGS = [
  { targetLanguage: "en", nativeLanguage: "en" },
  { targetLanguage: "fr", nativeLanguage: "en" },
  { targetLanguage: "de", nativeLanguage: "en" },
];

describe("chat persona prompt — language-agnostic contract", () => {
  it.each(CFGS)("speaks the configured target language ($targetLanguage)", (cfg) => {
    const prompt = chatSystemPrompt(cfg, []);
    expect(prompt).toContain(languageName(cfg.targetLanguage));
    expect(prompt).toContain("Sala");
  });

  it("is a friend, not a tutor", () => {
    const prompt = chatSystemPrompt(CFGS[0], []);
    expect(prompt).toMatch(/friend/i);
    expect(prompt).toMatch(/NOT a tutor/i);
    expect(prompt).toMatch(/comprehensible-input/i);
    expect(prompt).toMatch(/never babyish/i);
  });

  it("caps corrections at one per exchange, delivered as natural recast", () => {
    const prompt = chatSystemPrompt(CFGS[0], []);
    expect(prompt).toMatch(/at most ONE gentle correction/i);
    expect(prompt).toMatch(/recast/i);
    expect(prompt).toMatch(/never interrupt the flow/i);
    expect(prompt).toMatch(/articles, tense agreement, prepositions, word order/i);
  });

  it("asks one follow-up and keeps spoken-length replies", () => {
    const prompt = chatSystemPrompt(CFGS[0], []);
    expect(prompt).toMatch(/ONE follow-up question/i);
    expect(prompt).toMatch(/1-3 sentences/i);
  });

  it("forbids fabricated memories — the fact-checker integrity rule", () => {
    const prompt = chatSystemPrompt(CFGS[0], []);
    expect(prompt).toMatch(/HARD RULE: reference ONLY facts that appear in those two blocks/i);
    expect(prompt).toMatch(/never invent/i);
    // ...and the two blocks are named, so the model is told which memory surfaces exist
    expect(prompt).toMatch(/RECALLED CONTEXT is what this turn's words matched/i);
    expect(prompt).toMatch(/CONTINUING FROM is your standing history/i);
  });

  it("carries no recalled block when nothing was retrieved (honesty)", () => {
    expect(chatSystemPrompt(CFGS[0], [])).not.toContain(RECALL_MARKER);
  });

  it("embeds genuinely recalled facts verbatim under the marker", () => {
    const facts = ['The user logged (today): "finished the Sala server"'];
    const prompt = chatSystemPrompt(CFGS[0], facts);
    expect(prompt).toContain(RECALL_MARKER);
    expect(prompt).toContain(facts[0]);
  });

  it("snapshots stable for the default demo config", () => {
    // Guard against accidental prompt drift; update deliberately.
    const prompt = chatSystemPrompt({ targetLanguage: "en", nativeLanguage: "en" }, []);
    expect(prompt.length).toBeGreaterThan(800);
    expect(prompt).toMatchSnapshot();
  });
});

describe("review prompt contract", () => {
  it.each(CFGS)("writes the review panel in the learner's language ($nativeLanguage)", (cfg) => {
    const prompt = reviewSystemPrompt(cfg);
    expect(prompt).toContain(languageName(cfg.nativeLanguage));
    expect(prompt).toContain(languageName(cfg.targetLanguage));
  });

  it("demands strict JSON with verbatim learner examples", () => {
    const prompt = reviewSystemPrompt(CFGS[0]);
    expect(prompt).toMatch(/ONLY a JSON object/i);
    expect(prompt).toMatch(/WORD-FOR-WORD/i);
    expect(prompt).toMatch(/4-6 vocabulary items/i);
    expect(prompt).toMatch(/1-2 grammar points/i);
  });

  it("forbids fabricated grammar points", () => {
    const prompt = reviewSystemPrompt(CFGS[0]);
    expect(prompt).toMatch(/never fabricate teaching points/i);
    expect(prompt).toContain('"grammar": []');
  });

  it("snapshots stable", () => {
    expect(
      reviewSystemPrompt({ targetLanguage: "fr", nativeLanguage: "en" }),
    ).toMatchSnapshot();
  });
});

describe("languageName — unknown codes degrade honestly", () => {
  it("names known codes and describes unknown ones without inventing", () => {
    expect(languageName("en")).toBe("English");
    expect(languageName("fr")).toBe("French");
    expect(languageName("de")).toBe("German");
    expect(languageName("tlh")).toContain("tlh");
  });
});
