// @vitest-environment jsdom
// UI smoke test: mounts the real app, adds a What-if scenario through the
// UI, and exercises the "applied" checkbox end to end — including the
// file-sync focus race: the dev middleware normalizes saves to a trailing
// newline, and if the app's lastSaved text doesn't byte-match the file,
// the adopt poll (which also fires on window focus) stomps any edit
// younger than the autosave debounce.
import { describe, it, expect, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

let fileText = null; // emulated data/model.json, normalized like the middleware
const putBodies = [];

beforeAll(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  global.fetch = async (url, opts = {}) => {
    if (opts.method === "PUT") {
      putBodies.push(opts.body);
      fileText = opts.body.endsWith("\n") ? opts.body : opts.body + "\n"; // vite.config.js behavior
      return { ok: true, headers: { get: (h) => (h === "x-model-store" ? "1" : null) }, text: async () => "" };
    }
    return { ok: fileText !== null, headers: { get: (h) => (h === "x-model-store" ? "1" : null) }, text: async () => fileText ?? "" };
  };
});

describe("What-if applied checkbox", () => {
  it("survives the autosave debounce and a focus-triggered file sync", async () => {
    const { default: BudgetPlanner } = await import("./App.jsx");
    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => { root.render(React.createElement(BudgetPlanner)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    const button = (text) => [...div.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(text));
    await act(async () => { button("What-if").click(); });
    await act(async () => { button("+ Add a scenario").click(); });

    // let the autosave land so the emulated file holds the pre-click model
    await act(async () => { await new Promise((r) => setTimeout(r, 1100)); });
    expect(fileText).not.toBeNull();

    const appliedBox = () => [...div.querySelectorAll("label")]
      .find((l) => l.textContent.trim() === "applied")
      ?.querySelector("input[type=checkbox]");
    expect(appliedBox().checked).toBe(false);

    // the user's exact gesture: click the checkbox as the first click back
    // into the window — focus fires the adopt check before autosave runs
    await act(async () => { appliedBox().click(); });
    await act(async () => { window.dispatchEvent(new Event("focus")); await new Promise((r) => setTimeout(r, 200)); });
    expect(appliedBox().checked).toBe(true);
    expect(button("What-if").textContent).toContain("(1 on)");

    // and through the debounce window + a re-render tick
    await act(async () => { await new Promise((r) => setTimeout(r, 1200)); });
    expect(appliedBox().checked).toBe(true);

    // the sidebar mirrors the applied overlay and can turn it off from anywhere
    const side = div.querySelector(".bp-side");
    const sideRow = [...side.querySelectorAll(".bp-side-row")].find((l) => l.querySelector("input").checked);
    expect(sideRow).toBeTruthy();
    await act(async () => { sideRow.querySelector("input").click(); });
    expect(appliedBox().checked).toBe(false);
    expect(button("What-if").textContent).not.toContain("(1 on)");

    // every save must byte-match what the middleware stores
    for (const body of putBodies) expect(body.endsWith("\n")).toBe(true);
  }, 30000);

  it("sensitivity tab runs a sweep and renders both chart sections", async () => {
    const { default: BudgetPlanner } = await import("./App.jsx");
    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => { root.render(React.createElement(BudgetPlanner)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    const button = (text) => [...div.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(text));
    await act(async () => { button("Sensitivity").click(); });

    const varySelect = [...div.querySelectorAll("select")]
      .find((s) => [...s.querySelectorAll("option")].some((o) => o.value.startsWith("income:")));
    const firstIncome = [...varySelect.querySelectorAll("option")].find((o) => o.value.startsWith("income:"));
    await act(async () => {
      varySelect.value = firstIncome.value;
      varySelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => { button("Run analysis").click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 3000)); });

    const eyebrows = [...div.querySelectorAll(".bp-eyebrow")].map((e) => e.textContent);
    expect(eyebrows.some((t) => t.startsWith("Max "))).toBe(true);
    expect(eyebrows.some((t) => t.startsWith("End net worth"))).toBe(true);
  }, 60000);
});
