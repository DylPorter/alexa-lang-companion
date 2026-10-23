/**
 * Presentation-mode resolution. The interesting failure this pins is the `d`
 * shortcut firing while the presenter is typing in the composer — that would
 * toggle the frame mid-recording and quietly change the video.
 */
import { describe, expect, it } from "vitest";
import { deviceOrbVisible, deviceStateKey, isDeviceMode, isModeToggleKey, modeFromSearch } from "./presentation";

describe("modeFromSearch", () => {
  it("turns device mode on for the documented values", () => {
    for (const q of ["?device=1", "?device=true", "?device=yes", "?device=on", "?device", "?lang=de&device=1"]) {
      expect(modeFromSearch(q)).toBe("device");
    }
  });

  it("stays in console mode for everything else", () => {
    for (const q of ["", "?device=0", "?device=false", "?device=no", "?voicedebug=1", "?mcp=http://x/mcp"]) {
      expect(modeFromSearch(q)).toBe("console");
    }
  });

  it("is case and space insensitive (a pasted value with stray space still works)", () => {
    expect(modeFromSearch("?device=TRUE")).toBe("device");
    expect(modeFromSearch("?device= 1 ")).toBe("device");
    expect(modeFromSearch("?device=%201")).toBe("device");
    expect(modeFromSearch("?device=O")).toBe("console"); // near-miss stays off, not guessed on
  });

  it("defaults to console when there is no window (SSR / node env)", () => {
    expect(isDeviceMode("")).toBe(false);
  });
});

describe("isModeToggleKey", () => {
  const body = { target: { tagName: "BODY" } };

  it("toggles on a bare d/D outside a field", () => {
    expect(isModeToggleKey({ key: "d", ...body })).toBe(true);
    expect(isModeToggleKey({ key: "D", ...body })).toBe(true);
  });

  it("does NOT toggle while typing in the composer or any editable field", () => {
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(isModeToggleKey({ key: "d", target: { tagName: tag } })).toBe(false);
    }
    expect(isModeToggleKey({ key: "d", target: { tagName: "DIV", isContentEditable: true } })).toBe(false);
  });

  it("does NOT toggle on modified keystrokes (browser/IME combos stay intact)", () => {
    expect(isModeToggleKey({ key: "d", ...body, ctrlKey: true })).toBe(false);
    expect(isModeToggleKey({ key: "d", ...body, metaKey: true })).toBe(false);
    expect(isModeToggleKey({ key: "d", ...body, altKey: true })).toBe(false);
  });

  it("ignores every other key", () => {
    for (const key of ["a", "Enter", " ", "ArrowDown", "Dead"]) {
      expect(isModeToggleKey({ key, ...body })).toBe(false);
    }
  });

  it("survives a missing event target without throwing", () => {
    expect(isModeToggleKey({ key: "d" })).toBe(true);
  });
});

describe("deviceOrbVisible", () => {
  it("does not draw a second orb over the empty conversation's centred one", () => {
    expect(deviceOrbVisible({ hasTurns: false, hasReview: false })).toBe(false);
  });

  it("leads the frame once there is a conversation", () => {
    expect(deviceOrbVisible({ hasTurns: true, hasReview: false })).toBe(true);
  });

  it("steps aside for the review card, which needs the height", () => {
    expect(deviceOrbVisible({ hasTurns: true, hasReview: true })).toBe(false);
  });
});

describe("deviceStateKey", () => {
  it("keeps first-run copy before the conversation exists", () => {
    expect(deviceStateKey("idle", false)).toBe("idle");
  });

  it("stops telling a learner mid-conversation to say hi", () => {
    expect(deviceStateKey("idle", true)).toBe("waiting");
  });

  it("leaves the active states alone", () => {
    for (const orb of ["listening", "thinking", "speaking"] as const) {
      expect(deviceStateKey(orb, true)).toBe(orb);
      expect(deviceStateKey(orb, false)).toBe(orb);
    }
  });
});
