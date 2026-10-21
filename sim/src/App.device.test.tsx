// @vitest-environment jsdom
/**
 * Device vs console presentation mode, at the level that actually broke in the
 * browser check on 10-21: the opening frame drew TWO identical large orbs (the
 * device orb plus ConversationPane's own empty-state orb), and the `d` shortcut
 * had to be proven safe next to the composer. jsdom renders the app cold — the
 * MCP connect fails, which is fine: these are layout and keystroke-routing
 * assertions, not server behaviour.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "./App";

afterEach(cleanup);

/** Empty string is a same-document URL, so jsdom keeps the old query. Path-first. */
function setSearch(query: string) {
  window.history.replaceState({}, "", `/${query}`);
}

const mode = () => screen.getByTestId("app").getAttribute("data-mode");

describe("device mode", () => {
  it("is selected by ?device=1 and drops the admin column", () => {
    setSearch("?device=1");
    render(<App />);
    expect(mode()).toBe("device");
    expect(document.querySelector(".side-column")).toBeNull();
  });

  it("shows one presence orb, not two, before the first turn", () => {
    setSearch("?device=1");
    render(<App />);
    // Regression: the device orb stacked on the empty-state orb, so the literal
    // first frame of the demo showed two identical large orbs. The topbar's small
    // brand orb is intentional and stays; count the LARGE ones and the main region.
    expect(screen.queryByTestId("device-orb")).toBeNull();
    expect(screen.getByTestId("conversation-empty")).toBeTruthy();
    expect(document.querySelectorAll(".orb-large").length).toBe(1);
    expect(document.querySelectorAll("main .orb").length).toBe(1);
  });

  it("keeps the honesty label visible — the rules require the simulation shown", () => {
    setSearch("?device=1");
    render(<App />);
    expect(screen.getByTestId("sim-label").textContent).toMatch(/Simulated Alexa/);
  });
});

describe("console mode", () => {
  it("is the default and keeps the admin column", () => {
    setSearch("");
    render(<App />);
    expect(mode()).toBe("console");
    expect(document.querySelector(".side-column")).not.toBeNull();
    expect(document.querySelectorAll(".orb-large").length).toBe(1);
  });
});

describe("the `d` shortcut", () => {
  it("flips device to console and back, live", () => {
    setSearch("?device=1");
    render(<App />);
    fireEvent.keyDown(window, { key: "d" });
    expect(mode()).toBe("console");
    expect(document.querySelector(".side-column")).not.toBeNull();
    fireEvent.keyDown(window, { key: "d" });
    expect(mode()).toBe("device");
  });

  it("types a real 'd' instead of flipping the frame while the composer has focus", () => {
    setSearch("?device=1");
    render(<App />);
    const input = screen.getByTestId("composer-input");
    input.focus();
    fireEvent.keyDown(input, { key: "d" });
    expect(mode()).toBe("device");
  });
});
