// @vitest-environment jsdom
// UI smoke test: mounts the real app (default model), adds a What-if
// scenario through the UI, and exercises the "applied" checkbox end to
// end — render, tab switch, click, and survival of the autosave debounce.
import { describe, it, expect, vi, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

beforeAll(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  global.fetch = vi.fn(async (url, opts = {}) => ({
    ok: opts.method === "PUT", // no saved file yet; accept saves
    headers: { get: (h) => (h === "x-model-store" ? "1" : null) },
    text: async () => "",
  }));
});

describe("What-if applied checkbox", () => {
  it("toggles on click and stays checked through the autosave window", async () => {
    const { default: BudgetPlanner } = await import("./App.jsx");
    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => { root.render(React.createElement(BudgetPlanner)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    const button = (text) => [...div.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(text));
    await act(async () => { button("What-if").click(); });
    await act(async () => { button("+ Add a scenario").click(); });

    const appliedBox = () => [...div.querySelectorAll("label")]
      .find((l) => l.textContent.trim() === "applied")
      ?.querySelector("input[type=checkbox]");
    const box = appliedBox();
    expect(box).toBeTruthy();
    expect(box.checked).toBe(false);

    await act(async () => { box.click(); });
    expect(appliedBox().checked).toBe(true);
    expect(button("What-if").textContent).toContain("(1 on)");

    // survives the autosave debounce and any follow-on re-renders
    await act(async () => { await new Promise((r) => setTimeout(r, 1200)); });
    expect(appliedBox().checked).toBe(true);

    await act(async () => { appliedBox().click(); });
    expect(appliedBox().checked).toBe(false);
  }, 30000);
});
