// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import App from "./App";

afterEach(cleanup);

/** Empty string is a same-document URL, so jsdom keeps the old query. Path-first. */
function setSearch(query: string) {
  window.history.replaceState({}, "", `/${query}`);
}

describe("device mode renders", () => {
  it("hides the admin column and shows the presence orb", async () => {
    setSearch("?device=1");
    render(<App />);
    const app = screen.getByTestId("app");
    expect(app.getAttribute("data-mode")).toBe("device");
    expect(app.className).toContain("app-device");
    expect(screen.getByTestId("device-orb")).toBeTruthy();
    expect(document.querySelector(".side-column")).toBeNull();
    // the honesty label never disappears, in either mode
    expect(screen.getByTestId("sim-label").textContent).toMatch(/Simulated Alexa/);
  });

  it("keeps the admin column in console mode", () => {
    setSearch("");
    render(<App />);
    expect(screen.getByTestId("app").getAttribute("data-mode")).toBe("console");
    expect(document.querySelector(".side-column")).not.toBeNull();
  });
});
