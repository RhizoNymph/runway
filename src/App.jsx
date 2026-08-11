import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { MON, num, ymToAbs, absToYm, absLabel, valueAt, oneTimeAmount, simulate } from "./engine.js";
import { solveMax, trialItem } from "./solver.js";
import { applyVariant, variantMetrics, withApplied } from "./variants.js";
import { runSensitivity } from "./sensitivity.js";

/* ── persistence ──
   Primary store is data/model.json on disk, via the dev server's
   GET/PUT /api/model (see vite.config.js) — a plain pretty-printed JSON
   file that can be edited outside the browser, e.g. by an agent
   reconciling the budget against real spending. The app adopts external
   edits while running (see the watcher effect). Static builds, where the
   endpoint doesn't exist, fall back to localStorage exactly as before.
   The X-Model-Store response header distinguishes the real endpoint from
   a static host's catch-all route. */
const MODEL_KEY = "budget-model-v1";
const store = {
  mode: "local",
  async load() {
    try {
      const r = await fetch("/api/model", { cache: "no-store" });
      if (r.headers.get("x-model-store")) {
        store.mode = "file";
        if (r.ok) return await r.text();
        return localStorage.getItem(MODEL_KEY); // no file yet — migrate the browser copy
      }
    } catch { /* no dev server — static build */ }
    store.mode = "local";
    return localStorage.getItem(MODEL_KEY);
  },
  async save(v) {
    if (store.mode === "file") {
      try {
        const r = await fetch("/api/model", { method: "PUT", body: v, headers: { "Content-Type": "application/json" } });
        if (r.ok) return "file";
      } catch { /* server went away — fall back below */ }
    }
    localStorage.setItem(MODEL_KEY, v);
    return "local";
  },
};

/* ────────────────────────────── helpers ────────────────────────────── */

let _uid = 0;
const uid = () => `id${Date.now().toString(36)}${(_uid++).toString(36)}`;
const money = (n) =>
  (n < 0 ? "\u2212" : "") + "$" + Math.round(Math.abs(n)).toLocaleString("en-US");
const moneyK = (n) => {
  const s = n < 0 ? "\u2212" : "";
  const a = Math.abs(n);
  if (a >= 1000000) return s + "$" + (a / 1000000).toFixed(a >= 10000000 ? 0 : 1) + "M";
  if (a >= 1000) return s + "$" + Math.round(a / 1000) + "k";
  return s + "$" + Math.round(a);
};

/* ────────────────────────────── defaults ────────────────────────────── */

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const plusMonths = (ym, n) => absToYm(ymToAbs(ym) + n);

function makeDefaults() {
  const s0 = thisMonth();
  const move = plusMonths(s0, 2);
  const item = (name, amount, extra = {}) => ({ id: uid(), name, amount, growth: 0, startMonth: "", endMonth: "", changes: [], ...extra });
  const rent = item("Rent", 2200, { changes: [{ id: uid(), month: move, amount: 3800 }] });
  const brokerage = { id: uid(), name: "Brokerage (index)", type: "invest", balance: 10000, returnMode: "scenario", fixedRate: 7, contribMode: "fixed", contrib: 1000, primary: false, capAmount: 0, overflowTo: "" };

  return {
    settings: {
      startMonth: s0,
      horizonMonths: 60,
      filing: "single",
      stateTax: "CA",
      stateRate: 0,
      useFlatTax: false,
      flatTaxRate: 33,
      inflation: 3,
      milestones: [],
      mode401k: "pct",
      pct401k: 10,
      limit401k: 23500,
      ytd401k: 0,
      matchPct: 50,
      matchCapPct: 6,
    },
    incomes: [
      item("Salary (gross)", 14000, { growth: 3 }),
    ],
    expenses: [
      rent,
      item("Renter's insurance", 20),
      item("Groceries / food", 700, { growth: 3 }),
      item("Restaurants", 250),
      item("Electricity", 90),
      item("Water / sewer / trash", 60),
      item("Gas (home)", 45),
      item("Internet", 70),
      item("Phone", 60),
      item("Car payment", 420, { endMonth: plusMonths(s0, 23) }),
      item("Car insurance", 150),
      item("Fuel / charging", 130),
      item("Car maintenance", 90),
      item("Car registration (yearly)", 450, { cadence: "yearly", cadenceMonth: (ymToAbs(s0) % 12) + 1 }),
      item("Transit / rideshare", 100, { changes: [{ id: uid(), month: move, amount: 180 }] }),
      item("Health / dental premiums", 250),
      item("Subscriptions + software", 90),
      item("Fun / travel", 400),
      item("Gifts + misc", 150),
    ],
    oneTimes: [
      { id: uid(), name: "Relocation package (lump sum)", month: move, amount: 15000, kind: "in" },
      { id: uid(), name: "Signing bonus (after tax)", month: move, amount: 0, kind: "in" },
      { id: uid(), name: "Movers + truck", month: move, amount: 6000, kind: "out" },
      { id: uid(), name: "Deposit + first month", month: move, basis: "pct", itemId: rent.id, pct: 200, amount: 0, kind: "out" },
      { id: uid(), name: "Furniture + setup", month: plusMonths(s0, 3), amount: 3000, kind: "out" },
      { id: uid(), name: "Tax owed on relocation lump sum", month: plusMonths(s0, 3), amount: 5000, kind: "out" },
    ],
    accounts: [
      { id: uid(), name: "Checking + emergency fund", type: "cash", balance: 25000, returnMode: "fixed", fixedRate: 4, contribMode: "none", contrib: 0, primary: true, capAmount: 30000, overflowTo: brokerage.id, overflowStart: "" },
      brokerage,
      { id: uid(), name: "401(k)", type: "retirement", balance: 40000, returnMode: "scenario", fixedRate: 7, contribMode: "none", contrib: 0, primary: false, capAmount: 0, overflowTo: "" },
    ],
    scenarios: [
      { id: uid(), name: "Bear", rate: 3, color: "#C8256B" },
      { id: uid(), name: "Base", rate: 7, color: "#0E7C86" },
      { id: uid(), name: "Bull", rate: 10, color: "#D9611A" },
    ],
    solver: { itemId: null, fromMonth: "", cashFloor: 15000, endTarget: 0, useEndTarget: false },
    variants: [],
    sensitivity: null,
  };
}

/* ────────────────────────────── styles ────────────────────────────── */

const CSS = `
.bp * { box-sizing: border-box; }
.bp {
  --paper:#E7EAE3; --panel:#F6F7F3; --ink:#1B2430; --muted:#6E7A72;
  --rule:#C7CDBF; --rule2:#D9DED2;
  --pen1:#C8256B; --pen2:#0E7C86; --pen3:#D9611A; --pen4:#2B4C9B; --alarm:#B3261E;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background: var(--paper); color: var(--ink); font-family: var(--sans);
  min-height:100vh; padding: 20px 16px 80px; font-size:14px; line-height:1.45;
}
.bp-wrap { max-width: 1120px; margin: 0 auto; }

.bp-mast { display:flex; align-items:baseline; justify-content:space-between; gap:16px; flex-wrap:wrap;
  border-bottom:2px solid var(--ink); padding-bottom:10px; margin-bottom:4px; }
.bp-title { font-family: var(--mono); font-size: clamp(20px, 4.5vw, 30px); font-weight:600;
  letter-spacing:-0.04em; text-transform:uppercase; }
.bp-sub { font-family: var(--mono); font-size:11px; color:var(--muted); letter-spacing:0.08em; text-transform:uppercase; }

.bp-eyebrow { font-family:var(--mono); font-size:10.5px; letter-spacing:0.14em; text-transform:uppercase;
  color:var(--muted); margin:0 0 8px; display:flex; align-items:center; gap:10px; }
.bp-eyebrow::after { content:""; flex:1; height:1px; background:var(--rule); }

.bp-card { background:var(--panel); border:1px solid var(--rule); padding:14px 14px 16px; margin-top:18px; }

/* readout strip */
.bp-readout { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:1px;
  background:var(--rule); border:1px solid var(--rule); margin-top:16px; }
.bp-stat { background:var(--panel); padding:10px 12px; }
.bp-stat .k { font-family:var(--mono); font-size:10px; letter-spacing:0.1em; text-transform:uppercase; color:var(--muted); }
.bp-stat .v { font-family:var(--mono); font-size:19px; font-variant-numeric:tabular-nums; letter-spacing:-0.02em; margin-top:2px; }
.bp-stat .n { font-size:11px; color:var(--muted); }
.bp-neg { color:var(--alarm); }
.bp-pos { color:var(--pen2); }

.bp-alert { border-left:3px solid var(--alarm); background:#F7E9E7; padding:9px 12px; margin-top:14px;
  font-size:13px; }

/* controls */
.bp label.bp-lab { font-family:var(--mono); font-size:10px; letter-spacing:0.1em; text-transform:uppercase;
  color:var(--muted); display:block; margin-bottom:3px; }
.bp input, .bp select {
  font-family:var(--mono); font-size:13px; font-variant-numeric:tabular-nums;
  background:#fff; border:1px solid var(--rule); color:var(--ink);
  padding:5px 7px; width:100%; border-radius:0; -webkit-appearance:none; appearance:none;
}
.bp select { background-image:none; padding-right:7px; }
.bp input:focus, .bp select:focus { outline:2px solid var(--pen4); outline-offset:-1px; }
.bp input[type=range] { padding:0; border:0; background:transparent; accent-color:var(--pen4); }
.bp input[type=checkbox] { width:auto; accent-color:var(--pen4); }

.bp-btn { font-family:var(--mono); font-size:11px; letter-spacing:0.06em; text-transform:uppercase;
  background:transparent; border:1px solid var(--ink); color:var(--ink); padding:5px 10px; cursor:pointer; }
.bp-btn:hover { background:var(--ink); color:var(--paper); }
.bp-btn.solid { background:var(--ink); color:var(--paper); }
.bp-btn.solid:hover { background:var(--pen4); border-color:var(--pen4); }
.bp-btn.ghost { border-color:var(--rule); color:var(--muted); }
.bp-btn.ghost:hover { background:var(--rule); color:var(--ink); }
.bp-x { background:none; border:none; color:var(--muted); cursor:pointer; font-family:var(--mono);
  font-size:14px; line-height:1; padding:4px 6px; }
.bp-x:hover { color:var(--alarm); }
/* month picker */
.bp-mp { position:relative; }
.bp-mp-btn { font-family:var(--mono); background:#fff; border:1px solid var(--rule); border-left:0;
  color:var(--muted); cursor:pointer; padding:5px 6px; font-size:8px; flex:none; }
.bp-mp-btn:hover { color:var(--ink); background:var(--rule2); }
.bp-mp-pop { position:absolute; top:calc(100% + 4px); left:0; z-index:30; background:var(--panel);
  border:1px solid var(--ink); padding:8px; width:198px; box-shadow:3px 3px 0 rgba(27,36,48,0.18); }
.bp-mp-head { display:flex; justify-content:space-between; align-items:center; font-family:var(--mono);
  font-size:12px; margin-bottom:6px; }
.bp-mp-head button { background:none; border:1px solid var(--rule); cursor:pointer; color:var(--muted);
  font-size:8px; padding:3px 7px; font-family:var(--mono); }
.bp-mp-head button:hover { color:var(--ink); border-color:var(--ink); }
.bp-mp-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:3px; }
.bp-mp-cell { font-family:var(--mono); font-size:10.5px; text-transform:uppercase; letter-spacing:0.04em;
  background:#fff; border:1px solid var(--rule); color:var(--ink); cursor:pointer; padding:6px 0; }
.bp-mp-cell:hover { border-color:var(--pen4); color:var(--pen4); }
.bp-mp-cell.on { background:var(--pen4); border-color:var(--pen4); color:#fff; }
.bp-mp-foot { display:flex; justify-content:space-between; margin-top:6px; }
.bp-mp-foot button { background:none; border:none; color:var(--muted); cursor:pointer; font-family:var(--mono);
  font-size:9.5px; letter-spacing:0.06em; text-transform:uppercase; padding:2px 0; }
.bp-mp-foot button:hover { color:var(--pen4); }

.bp-handle { cursor:grab; color:var(--muted); font-family:var(--mono); font-size:13px; line-height:1;
  text-align:center; user-select:none; -webkit-user-select:none; padding:6px 2px; align-self:end;
  border:1px solid transparent; }
.bp-handle:hover { color:var(--ink); border-color:var(--rule); }
.bp-handle:active { cursor:grabbing; }
.bp-row.bp-dragging { opacity:0.35; }
.bp-row.bp-drop-before { box-shadow: inset 0 3px 0 var(--pen4); }
.bp-row.bp-drop-after { box-shadow: inset 0 -3px 0 var(--pen4); }

/* tabs */
.bp-tabs { display:flex; gap:0; flex-wrap:wrap; border-bottom:1px solid var(--rule); margin-top:24px; }
.bp-tab { font-family:var(--mono); font-size:11px; letter-spacing:0.08em; text-transform:uppercase;
  background:none; border:none; border-bottom:2px solid transparent; color:var(--muted);
  padding:8px 12px; cursor:pointer; margin-bottom:-1px; }
.bp-tab:hover { color:var(--ink); }
.bp-tab[data-on="1"] { color:var(--ink); border-bottom-color:var(--pen4); }

/* item rows */
.bp-row { border-bottom:1px solid var(--rule2); padding:7px 0; }
.bp-grid { display:grid; gap:8px; align-items:end; }
.bp-item { grid-template-columns: minmax(0,1fr) 96px 64px 62px 30px 24px 26px 30px; }
.bp-onetime { grid-template-columns: minmax(0,1fr) 118px 130px 92px 24px 26px 30px; }
.bp-skip { padding-bottom: 6px; }
.bp-acct { grid-template-columns: minmax(0,1fr) 108px 108px 92px 110px 26px 30px; }
@media (max-width: 720px) {
  .bp-item, .bp-onetime, .bp-acct { grid-template-columns: 1fr 1fr; }
  .bp-item > :first-child, .bp-onetime > :first-child, .bp-acct > :first-child { grid-column:1 / -1; }
}
.bp-changes { margin:6px 0 4px 0; padding-left:12px; border-left:2px solid var(--pen4); }
.bp-chg { display:grid; grid-template-columns:1fr 74px 1fr 30px; gap:8px; align-items:end; margin-bottom:6px; }
.bp-tot { display:flex; justify-content:space-between; font-family:var(--mono); font-size:13px;
  font-variant-numeric:tabular-nums; padding-top:10px; margin-top:4px; border-top:2px solid var(--ink); }

/* allocation bar */
.bp-alloc { display:flex; height:26px; border:1px solid var(--ink); overflow:hidden; margin-top:6px; }
.bp-alloc div { display:flex; align-items:center; justify-content:center; font-family:var(--mono);
  font-size:9.5px; color:#fff; overflow:hidden; white-space:nowrap; }
.bp-key { display:flex; flex-wrap:wrap; gap:12px; margin-top:8px; font-family:var(--mono); font-size:10.5px; color:var(--muted); }
.bp-key i { display:inline-block; width:9px; height:9px; margin-right:5px; }

/* solver gauge */
.bp-gauge { position:relative; height:56px; margin-top:14px; border-bottom:1px solid var(--ink); }
.bp-band { position:absolute; bottom:0; height:14px; }
.bp-mark { position:absolute; bottom:0; width:2px; height:34px; }
.bp-mark span { position:absolute; bottom:36px; left:50%; transform:translateX(-50%); white-space:nowrap;
  font-family:var(--mono); font-size:10.5px; letter-spacing:0.04em; }
.bp-gticks { display:flex; justify-content:space-between; font-family:var(--mono); font-size:10px; color:var(--muted); }

/* table */
.bp-tblwrap { overflow-x:auto; margin-top:8px; }
.bp table { border-collapse:collapse; width:100%; font-family:var(--mono); font-size:12px;
  font-variant-numeric:tabular-nums; white-space:nowrap; }
.bp th { text-align:right; font-weight:500; font-size:9.5px; letter-spacing:0.1em; text-transform:uppercase;
  color:var(--muted); border-bottom:1px solid var(--ink); padding:5px 9px; }
.bp th:first-child, .bp td:first-child { text-align:left; }
.bp td { text-align:right; padding:5px 9px; border-bottom:1px solid var(--rule2); }
.bp tr:hover td { background:#EDEFE8; }

.bp-note { font-size:11.5px; color:var(--muted); margin-top:8px; }
.bp-hint { font-size:11.5px; color:var(--muted); }
.bp-flex { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
.bp-fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; }
@media (prefers-reduced-motion: reduce) { .bp * { transition:none !important; } }
`;

/* ────────────────────────────── small inputs ────────────────────────────── */

function NumInput({ value, onChange, step = 1, min, placeholder, title }) {
  const [txt, setTxt] = useState(String(value ?? ""));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setTxt(String(value ?? "")); }, [value, focus]);
  return (
    <input
      type="number" step={step} min={min} title={title} placeholder={placeholder}
      value={focus ? txt : String(value ?? "")}
      onFocus={() => { setFocus(true); setTxt(String(value ?? "")); }}
      onBlur={() => setFocus(false)}
      onChange={(e) => { setTxt(e.target.value); onChange(e.target.value === "" ? 0 : num(e.target.value)); }}
    />
  );
}

const TextInput = (p) => (
  <input type="text" value={p.value} placeholder={p.placeholder}
    onChange={(e) => p.onChange(e.target.value)} />
);
/* Month field with a popover picker (native type="month" has no picker in
   Firefox/Safari). Typing YYYY-MM directly still works; empty means "no date". */
function MonthInput({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(false);
  const [txt, setTxt] = useState(value || "");
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const ref = useRef(null);

  useEffect(() => { if (!focus) setTxt(value || ""); }, [value, focus]);
  useEffect(() => {
    if (!open) return;
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);

  const sel = ymToAbs(value);
  const toggle = () => {
    if (!open) setViewYear(sel !== null ? Math.floor(sel / 12) : new Date().getFullYear());
    setOpen(!open);
  };
  const pick = (m) => { onChange(`${viewYear}-${String(m + 1).padStart(2, "0")}`); setOpen(false); };

  return (
    <div className="bp-mp" ref={ref}>
      <div className="bp-flex" style={{ flexWrap: "nowrap", gap: 0 }}>
        <input type="text" placeholder="YYYY-MM" value={focus ? txt : (value || "")}
          onFocus={() => { setFocus(true); setTxt(value || ""); }}
          onBlur={() => setFocus(false)}
          onChange={(e) => {
            const v = e.target.value;
            setTxt(v);
            if (v === "" || ymToAbs(v) !== null) onChange(v);
          }} />
        <button type="button" className="bp-mp-btn" title="Pick a month" onClick={toggle}>&#9660;</button>
      </div>
      {open && (
        <div className="bp-mp-pop">
          <div className="bp-mp-head">
            <button type="button" title="Previous year" onClick={() => setViewYear(viewYear - 1)}>&#9664;</button>
            <span>{viewYear}</span>
            <button type="button" title="Next year" onClick={() => setViewYear(viewYear + 1)}>&#9654;</button>
          </div>
          <div className="bp-mp-grid">
            {MON.map((m, i) => (
              <button type="button" key={m}
                className={"bp-mp-cell" + (sel !== null && viewYear === Math.floor(sel / 12) && i === sel % 12 ? " on" : "")}
                onClick={() => pick(i)}>{m}</button>
            ))}
          </div>
          <div className="bp-mp-foot">
            <button type="button" onClick={() => { onChange(""); setOpen(false); }}>Clear</button>
            <button type="button" onClick={() => { onChange(thisMonth()); setOpen(false); }}>This month</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return <div><label className="bp-lab">{label}</label>{children}</div>;
}

/* Drag-to-reorder for a list of {id} items. Returns prop bags: spread
   rowProps(id) on each row container and handleProps(id) on its drag handle.
   The drop position (above/below the hovered row) follows the pointer's
   vertical midpoint; commit receives the reordered list. */
function useDragReorder(items, commit) {
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null); // { id, after }
  const end = () => { setDragId(null); setOver(null); };
  const halfOf = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY > r.top + r.height / 2;
  };

  const rowProps = (id) => ({
    className: "bp-row"
      + (id === dragId ? " bp-dragging" : "")
      + (over?.id === id ? (over.after ? " bp-drop-after" : " bp-drop-before") : ""),
    onDragOver: (e) => {
      if (dragId === null || id === dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const after = halfOf(e);
      setOver((o) => (o?.id === id && o.after === after ? o : { id, after }));
    },
    onDrop: (e) => {
      e.preventDefault();
      if (dragId !== null && id !== dragId) {
        const dragged = items.find((x) => x.id === dragId);
        const rest = items.filter((x) => x.id !== dragId);
        const idx = rest.findIndex((x) => x.id === id) + (halfOf(e) ? 1 : 0);
        commit([...rest.slice(0, idx), dragged, ...rest.slice(idx)]);
      }
      end();
    },
  });

  const handleProps = (id) => ({
    className: "bp-handle",
    draggable: true,
    title: "Drag to reorder",
    onDragStart: (e) => {
      setDragId(id);
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", ""); } catch { /* older engines */ }
      const row = e.currentTarget.closest(".bp-row");
      if (row) e.dataTransfer.setDragImage(row, 24, 16);
    },
    onDragEnd: end,
  });

  return { rowProps, handleProps };
}

const Handle = (p) => <span {...p}>&#8942;&#8942;</span>;

/* ────────────────────────────── item editor ────────────────────────────── */

function ItemRow({ item, onChange, onRemove, dragRow, dragHandle, kind, startAbs, income }) {
  const [open, setOpen] = useState(false);
  const set = (patch) => onChange({ ...item, ...patch });
  const changes = item.changes || [];
  const nChanges = changes.length;
  const yearly = item.cadence === "yearly";
  const scheduled = nChanges > 0 || item.startMonth || item.endMonth || yearly || item.afterTax;

  return (
    <div {...dragRow} style={item.disabled ? { opacity: 0.5 } : undefined}>
      <div className="bp-grid bp-item">
        <div>
          {kind === "first" && <label className="bp-lab">Name</label>}
          <TextInput value={item.name} onChange={(v) => set({ name: v })} placeholder="Line item" />
        </div>
        <div>
          {kind === "first" && <label className="bp-lab">Amount</label>}
          <NumInput value={item.amount} onChange={(v) => set({ amount: v })} step={10} />
        </div>
        <div>
          {kind === "first" && <label className="bp-lab">Every</label>}
          <select value={yearly ? "yearly" : "monthly"}
            title="Monthly amounts recur every month; a yearly amount is charged once a year in its month"
            onChange={(e) => set({
              cadence: e.target.value,
              cadenceMonth: item.cadenceMonth || (startAbs % 12) + 1,
            })}>
            <option value="monthly">month</option>
            <option value="yearly">year</option>
          </select>
        </div>
        <div>
          {kind === "first" && <label className="bp-lab">%/yr</label>}
          <NumInput value={item.growth} onChange={(v) => set({ growth: v })} step={0.5}
            title="Annual growth: raises for income, inflation for expenses" />
        </div>
        <button className="bp-btn ghost" onClick={() => setOpen(!open)}
          title="Schedule changes, start and end dates"
          style={{ padding: "5px 0", color: scheduled ? "var(--pen4)" : undefined, borderColor: scheduled ? "var(--pen4)" : undefined }}>
          {scheduled ? (nChanges || "\u25CF") : "\u2026"}
        </button>
        <div className="bp-skip">
          {kind === "first" && <label className="bp-lab">Skip</label>}
          <input type="checkbox" checked={!!item.disabled} title="Temporarily remove from the plan"
            onChange={(e) => set({ disabled: e.target.checked })} />
        </div>
        <Handle {...dragHandle} />
        <button className="bp-x" onClick={onRemove} title="Remove">&#10005;</button>
      </div>

      {open && (
        <div className="bp-changes">
          {income && (
            <label className="bp-hint" style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}
              title="For money that is already taxed on someone else's return — an unmarried partner's take-home, say. It skips your tax, FICA, and 401(k)/match math and lands straight in net income.">
              <input type="checkbox" checked={!!item.afterTax}
                onChange={(e) => set({ afterTax: e.target.checked })} />
              post-tax: taxed on someone else's return; skips taxes and 401(k), lands straight in net
            </label>
          )}
          <div className="bp-grid" style={{ gridTemplateColumns: yearly ? "1fr 1fr 1fr" : "1fr 1fr", marginBottom: 8 }}>
            <Field label="Starts"><MonthInput value={item.startMonth} onChange={(v) => set({ startMonth: v })} /></Field>
            <Field label="Ends (last month)"><MonthInput value={item.endMonth} onChange={(v) => set({ endMonth: v })} /></Field>
            {yearly && (
              <Field label="Charged every">
                <select value={num(item.cadenceMonth) >= 1 && num(item.cadenceMonth) <= 12 ? num(item.cadenceMonth) : 1}
                  onChange={(e) => set({ cadenceMonth: Number(e.target.value) })}>
                  {MON.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </Field>
            )}
          </div>
          {changes.map((c, i) => (
            <div className="bp-chg" key={c.id}>
              <Field label={i === 0 ? "From month" : ""}>
                <MonthInput value={c.month} onChange={(v) => set({ changes: changes.map((x) => x.id === c.id ? { ...x, month: v } : x) })} />
              </Field>
              <Field label={i === 0 ? "Mode" : ""}>
                <select value={c.mode === "delta" ? "delta" : "set"}
                  title="'set to' replaces the amount; '± by' adds to whatever is in effect then (negative allowed)"
                  onChange={(e) => set({ changes: changes.map((x) => x.id === c.id ? { ...x, mode: e.target.value } : x) })}>
                  <option value="set">set to</option>
                  <option value="delta">&#177; by</option>
                </select>
              </Field>
              <Field label={i === 0 ? "$ / month" : ""}>
                <NumInput value={c.amount} step={10} onChange={(v) => set({ changes: changes.map((x) => x.id === c.id ? { ...x, amount: v } : x) })} />
              </Field>
              <button className="bp-x" onClick={() => set({ changes: changes.filter((x) => x.id !== c.id) })}>&#10005;</button>
            </div>
          ))}
          <button className="bp-btn ghost"
            onClick={() => set({ changes: [...changes, { id: uid(), month: "", amount: item.amount }] })}>
            + Change on a date
          </button>
          <div className="bp-note">
            "Set to" replaces the amount from that month onward; "&#177; by" adds to whatever is in effect
            (use a negative number to decrease). Deltas stack until a "set to" resets the base.
          </div>
        </div>
      )}
    </div>
  );
}

function ItemList({ items, setItems, addLabel, monthLabel, startAbs, income }) {
  const total = items.reduce((t, i) => t + valueAt(i, startAbs, startAbs), 0);
  const { rowProps, handleProps } = useDragReorder(items, setItems);
  const yearlySum = items.reduce((t, i) => t + (i.cadence === "yearly" && !i.disabled ? num(i.amount) : 0), 0);
  const [sortDesc, setSortDesc] = useState(true);
  // monthly-equivalent amount; skipped items sink to the bottom either way
  const sortKey = (i) => (i.disabled ? -1 : num(i.amount) / (i.cadence === "yearly" ? 12 : 1));
  const sortByAmount = () => {
    const dir = sortDesc ? 1 : -1;
    setItems([...items].sort((a, b) => (sortKey(b) - sortKey(a)) * dir));
    setSortDesc(!sortDesc);
  };
  return (
    <div>
      {items.map((it, idx) => (
        <ItemRow key={it.id} item={it} kind={idx === 0 ? "first" : ""} startAbs={startAbs} income={income}
          onChange={(v) => setItems(items.map((x) => (x.id === it.id ? v : x)))}
          onRemove={() => setItems(items.filter((x) => x.id !== it.id))}
          dragRow={rowProps(it.id)} dragHandle={handleProps(it.id)} />
      ))}
      <div className="bp-tot"><span>{monthLabel}</span><span>{money(total)}</span></div>
      {yearlySum > 0 && (
        <div className="bp-note">
          Yearly items total {money(yearlySum)}/yr (≈ {money(yearlySum / 12)}/mo averaged); each is charged in full
          in its month, so monthly totals spike there.
        </div>
      )}
      <div className="bp-flex" style={{ marginTop: 12 }}>
        <button className="bp-btn" onClick={() => setItems([...items, {
          id: uid(), name: "", amount: 0, growth: 0, startMonth: "", endMonth: "", changes: [],
        }])}>+ {addLabel}</button>
        <button className="bp-btn ghost" onClick={sortByAmount}
          title="Reorders the list by monthly-equivalent amount (yearly items ÷ 12); skipped items go last. Click again to flip direction.">
          Sort by amount {sortDesc ? "↓" : "↑"}
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────── main app ────────────────────────────── */

export default function BudgetPlanner() {
  const [model, setModel] = useState(makeDefaults);
  const [tab, setTab] = useState("expenses");
  const [loaded, setLoaded] = useState(false);
  const [saveNote, setSaveNote] = useState("");
  const [solved, setSolved] = useState(null);
  const [showMaxRent, setShowMaxRent] = useState(false);
  const fileRef = useRef(null);
  const lastSaved = useRef(""); // exact text last read from / written to the store

  const { settings, incomes, expenses, oneTimes, accounts, scenarios, solver } = model;
  const patch = (p) => setModel((m) => ({ ...m, ...p }));
  const variantsList = model.variants || [];
  /* what-if scenarios checked "applied" overlay the live plan everywhere
     below (charts, readouts, solver); the editors keep the raw lines */
  const effective = useMemo(() => withApplied(model), [model]);
  const setSettings = (p) => setModel((m) => ({ ...m, settings: { ...m.settings, ...p } }));
  const setSolver = (p) => setModel((m) => ({ ...m, solver: { ...m.solver, ...p } }));

  const dragOneTimes = useDragReorder(oneTimes, (v) => patch({ oneTimes: v }));
  const [otSortDesc, setOtSortDesc] = useState(true);
  const dragAccounts = useDragReorder(accounts, (v) => patch({ accounts: v }));
  const dragScenarios = useDragReorder(scenarios, (v) => patch({ scenarios: v }));

  /* load / autosave */
  useEffect(() => {
    (async () => {
      try {
        const text = await store.load();
        if (text) {
          const parsed = JSON.parse(text);
          if (parsed && parsed.settings) { setModel({ ...makeDefaults(), ...parsed }); lastSaved.current = text; }
        }
      } catch (e) { /* nothing saved yet */ }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(async () => {
      try {
        // must byte-match what the dev middleware stores (it normalizes to a
        // trailing newline) — the adopt poll compares exact text against the
        // file, and any mismatch makes it stomp in-memory edits every 3s
        const text = JSON.stringify(model, null, 2) + "\n";
        if (text === lastSaved.current) return;
        const where = await store.save(text);
        lastSaved.current = text;
        setSaveNote(where === "file" ? "Saved \u2192 data/model.json" : "Saved");
        setTimeout(() => setSaveNote(""), 1400);
      } catch (e) { setSaveNote("Not saved \u2014 use Export"); }
    }, 900);
    return () => clearTimeout(t);
  }, [model, loaded]);

  /* adopt edits made to data/model.json outside the browser */
  useEffect(() => {
    if (!loaded || store.mode !== "file") return;
    let gone = false;
    const check = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch("/api/model", { cache: "no-store" });
        if (gone || !r.ok || !r.headers.get("x-model-store")) return;
        const text = await r.text();
        if (gone || !text || text === lastSaved.current) return;
        const parsed = JSON.parse(text);
        if (parsed && parsed.settings) {
          lastSaved.current = text;
          setModel({ ...makeDefaults(), ...parsed });
          setSaveNote("Reloaded from data/model.json");
          setTimeout(() => setSaveNote(""), 2200);
        }
      } catch { /* mid-edit or invalid file \u2014 try again next tick */ }
    };
    const iv = setInterval(check, 3000);
    window.addEventListener("focus", check);
    return () => { gone = true; clearInterval(iv); window.removeEventListener("focus", check); };
  }, [loaded]);

  const startAbs = ymToAbs(settings.startMonth) ?? new Date().getFullYear() * 12;

  /* run every scenario */
  const sims = useMemo(() => {
    const out = {};
    scenarios.forEach((s) => { out[s.id] = simulate(effective, num(s.rate)); });
    return out;
  }, [effective, scenarios]);

  const baseScenario = scenarios[Math.min(1, scenarios.length - 1)] || scenarios[0];
  const base = sims[baseScenario?.id] || simulate(model, 7);
  const m0 = base.rows[0] || {};

  const netWorthData = base.rows.map((r, i) => {
    const o = { label: r.label };
    scenarios.forEach((s) => { o[s.name] = Math.round(sims[s.id].rows[i]?.total ?? 0); });
    return o;
  });
  const cashData = base.rows.map((r) => ({
    label: r.label, Cash: Math.round(r.cash), Investments: Math.round(r.invest), Retirement: Math.round(r.retire),
  }));

  const yearRows = useMemo(() => {
    const by = new Map();
    base.rows.forEach((r) => {
      if (!by.has(r.year)) by.set(r.year, { year: r.year, net: 0, exp: 0, saved: 0, one: 0, last: r });
      const y = by.get(r.year);
      y.net += r.net; y.exp += r.exp; y.saved += r.saved; y.one += r.inflow - r.outflow; y.last = r;
    });
    return [...by.values()];
  }, [base]);

  /* allocation of month one */
  const alloc = [
    { k: "Taxes", v: m0.tax || 0, c: "#8A94A6" },
    { k: "Living costs", v: m0.exp || 0, c: "#1B2430" },
    { k: "401(k)", v: m0.c401 || 0, c: "#2B4C9B" },
    { k: "Transfers", v: m0.transfers || 0, c: "#0E7C86" },
    { k: (m0.surplus || 0) >= 0 ? "Left over" : "Shortfall", v: Math.abs(m0.surplus || 0), c: (m0.surplus || 0) >= 0 ? "#D9611A" : "#B3261E" },
  ];
  const allocTotal = alloc.reduce((t, a) => t + a.v, 0) || 1;
  const income0 = (m0.gross || 0) + (m0.postTax || 0);
  const savingsRate = income0 ? ((m0.c401 + m0.match + m0.transfers + Math.max(0, m0.surplus)) / income0) * 100 : 0;

  /* ── rent solver ── */
  const solverItem = expenses.find((e) => e.id === solver.itemId)
    || expenses.find((e) => /rent|mortgage|housing/i.test(e.name))
    || expenses[0];

  function runSolver() {
    if (!solverItem) return;
    setSolved(solveMax(effective, {
      itemId: solverItem.id,
      fromMonth: solver.fromMonth,
      cashFloor: solver.cashFloor,
      endTarget: solver.endTarget,
      useEndTarget: solver.useEndTarget,
      rate: num(baseScenario?.rate ?? 7),
    }));
  }

  /* writes the exact item the solver tested (rounded down to $25), so the
     applied plan matches the reported minCash / end total */
  function applySolved() {
    if (!solved || solved.infeasible || !solverItem) return;
    const t = trialItem(solverItem, solved.fromM, Math.floor(solved.value / 25) * 25);
    patch({
      expenses: expenses.map((e) => e.id === solverItem.id
        ? { ...t, changes: t.changes.map((c) => (c.id === "solve" ? { ...c, id: uid() } : c)) } : e),
    });
  }

  /* ── what-if variants: overlays compared against the live baseline ── */
  const setVariants = (v) => patch({ variants: v });
  const setTweak = (v, t, p) => setVariants(variantsList.map((x) => x.id === v.id
    ? { ...x, tweaks: (x.tweaks || []).map((y) => (y.id === t.id ? { ...y, ...p } : y)) } : x));

  /* baseline = the plan with every applied scenario on. An unapplied row
     adds its scenario on top; an applied row shows the plan *without* it,
     so every delta reads as "what toggling this checkbox does". */
  const whatif = useMemo(() => {
    if (tab !== "whatif") return null;
    const rate = num(baseScenario?.rate ?? 7);
    const applied = variantsList.filter((v) => v.applied);
    const withoutOne = (skipId) =>
      applied.filter((v) => v.id !== skipId).reduce((m, v) => applyVariant(m, v), model);
    const rows = [
      { id: "baseline", name: "Baseline (current plan)", varied: effective },
      ...variantsList.map((v) => ({
        id: v.id,
        name: (v.name || "(unnamed)") + (v.applied ? " — applied; this row removes it" : ""),
        varied: v.applied ? withoutOne(v.id) : applyVariant(effective, v),
      })),
    ];
    return rows.map((row) => {
      const met = variantMetrics(row.varied, rate);
      let maxRent = null;
      if (showMaxRent && solverItem) {
        const s = solveMax(row.varied, {
          itemId: solverItem.id, fromMonth: solver.fromMonth, cashFloor: solver.cashFloor,
          endTarget: solver.endTarget, useEndTarget: solver.useEndTarget, rate,
        });
        maxRent = s && !s.infeasible ? Math.floor(s.value / 25) * 25 : NaN;
      }
      return { ...row, ...met, maxRent };
    });
  }, [tab, model, effective, showMaxRent]);

  const bakeVariant = (v) => {
    if (!confirm(`Permanently write "${v.name || "this scenario"}" into the expense lines and remove it from the list?`)) return;
    const baked = applyVariant(model, v);
    patch({ expenses: baked.expenses, variants: variantsList.filter((x) => x.id !== v.id) });
  };

  /* ── sensitivity analysis: sweep one or two items' amounts ── */
  const sens = model.sensitivity || {};
  const [sensResult, setSensResult] = useState(null);
  const [sensBusy, setSensBusy] = useState(false);
  const sensLists = { income: incomes, expense: expenses, onetime: oneTimes };
  const sensItemName = (axis) =>
    (sensLists[axis?.kind] || []).find((x) => x.id === axis?.itemId)?.name || "(unnamed)";
  const pickSensAxis = (which, encoded) => {
    if (!encoded) { patch({ sensitivity: { ...sens, [which]: null } }); return; }
    const [kind, itemId] = encoded.split(":");
    const amt = num((sensLists[kind] || []).find((x) => x.id === itemId)?.amount);
    const max = amt > 0 ? Math.ceil((amt * 2) / 500) * 500 : 5000;
    patch({ sensitivity: { ...sens, [which]: { kind, itemId, min: 0, max, steps: which === "a" ? 9 : 4 } } });
  };
  const setSensAxis = (which, p) =>
    patch({ sensitivity: { ...sens, [which]: { ...sens[which], ...p } } });

  const runSens = () => {
    if (!sens.a?.itemId || !solverItem) return;
    setSensBusy(true);
    setTimeout(() => { // let the busy note paint before the synchronous grid run
      try {
        const rate = num(baseScenario?.rate ?? 7);
        const res = runSensitivity(effective, {
          a: sens.a,
          b: sens.b?.itemId ? { ...sens.b, steps: Math.max(2, Math.min(5, Math.round(num(sens.b.steps)) || 4)) } : null,
          solve: {
            itemId: solverItem.id, fromMonth: solver.fromMonth, cashFloor: solver.cashFloor,
            endTarget: solver.endTarget, useEndTarget: solver.useEndTarget, rate,
          },
        });
        setSensResult({ res, aName: sensItemName(sens.a), bName: sens.b?.itemId ? sensItemName(sens.b) : null });
      } finally { setSensBusy(false); }
    }, 30);
  };

  /* sequential ramp for the second variable (light → dark as it grows);
     single-series charts use the app's fixed hues instead */
  const SENS_RAMP = ["#C4DEDF", "#8FBDBF", "#5C9EA1", "#2F7C80", "#0B4F53"];
  const sensCharts = useMemo(() => {
    if (!sensResult) return null;
    const { res, aName, bName } = sensResult;
    const multi = res.bValues[0] !== null;
    const seriesKeys = res.bValues.map((bv) => (multi ? money(bv) : "value"));
    const data = res.aValues.map((av, i) => {
      const row = { a: av };
      res.bValues.forEach((bv, j) => {
        const c = res.cells[j * res.aValues.length + i];
        row[`rent:${seriesKeys[j]}`] = Number.isNaN(c.maxRent) ? null : Math.round(c.maxRent);
        row[`end:${seriesKeys[j]}`] = Number.isNaN(c.end) ? null : Math.round(c.end);
      });
      return row;
    });
    const color = (j, mono) => (multi
      ? SENS_RAMP[Math.round((j * (SENS_RAMP.length - 1)) / Math.max(1, res.bValues.length - 1))]
      : mono);
    const currentA = num((sensLists[sens.a?.kind] || []).find((x) => x.id === sens.a?.itemId)?.amount);
    return { data, seriesKeys, aName, bName, multi, color, currentA };
  }, [sensResult]);

  /* import / export */
  function exportJson() {
    const blob = new Blob([JSON.stringify(model, null, 2) + "\n"], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "budget-scenario.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function importJson(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed = JSON.parse(String(r.result));
        if (parsed && parsed.settings) setModel({ ...makeDefaults(), ...parsed });
      } catch (err) { setSaveNote("That file could not be read"); }
    };
    r.readAsText(f);
    e.target.value = "";
  }

  const gaugeMax = Math.max(6000, Math.ceil(((solved?.value || 4000) * 1.4) / 500) * 500);

  const tooltipStyle = {
    background: "#F6F7F3", border: "1px solid #1B2430", borderRadius: 0,
    fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12,
  };

  return (
    <div className="bp">
      <style>{CSS}</style>
      <div className="bp-wrap">

        <div className="bp-mast">
          <div>
            <div className="bp-title">Runway</div>
            <div className="bp-sub">Budget &amp; savings simulator · {settings.horizonMonths} months from {absLabel(startAbs)}</div>
          </div>
          <div className="bp-flex">
            <span className="bp-hint" style={{ fontFamily: "var(--mono)", fontSize: 10.5 }}>{saveNote}</span>
            <button className="bp-btn ghost" onClick={exportJson}>Export</button>
            <button className="bp-btn ghost" onClick={() => fileRef.current?.click()}>Import</button>
            <input ref={fileRef} type="file" accept="application/json" onChange={importJson} style={{ display: "none" }} />
          </div>
        </div>

        {/* readout */}
        <div className="bp-readout">
          <div className="bp-stat">
            <div className="k">Take-home / mo</div>
            <div className="v">{money(m0.net || 0)}</div>
            <div className="n">after tax &amp; 401(k)</div>
          </div>
          <div className="bp-stat">
            <div className="k">Living costs / mo</div>
            <div className="v">{money(m0.exp || 0)}</div>
            <div className="n">{expenses.length} line items</div>
          </div>
          <div className="bp-stat">
            <div className="k">Left over / mo</div>
            <div className={"v " + ((m0.surplus || 0) < 0 ? "bp-neg" : "bp-pos")}>{money(m0.surplus || 0)}</div>
            <div className="n">after {money(m0.transfers || 0)} transferred</div>
          </div>
          <div className="bp-stat">
            <div className="k">Savings rate</div>
            <div className="v">{savingsRate.toFixed(0)}%</div>
            <div className="n">of gross, incl. match</div>
          </div>
          <div className="bp-stat">
            <div className="k">Lowest cash</div>
            <div className={"v " + (base.minCash < 0 ? "bp-neg" : "")}>{moneyK(base.minCash)}</div>
            <div className="n">in {absLabel(base.minCashAbs)}</div>
          </div>
          <div className="bp-stat">
            <div className="k">Net worth at end</div>
            <div className="v">{moneyK(base.endTotal)}</div>
            <div className="n">{baseScenario?.name} · {baseScenario?.rate}%/yr</div>
          </div>
        </div>

        {base.firstNegative !== null && (
          <div className="bp-alert">
            <strong>Cash runs out in {absLabel(base.firstNegative)}.</strong> Lower an expense, delay a one-time cost,
            or reduce transfers into investment accounts before that month.
          </div>
        )}

        {/* where the money goes */}
        <div className="bp-card">
          <div className="bp-eyebrow">Where the first month goes — {money(m0.gross || 0)} gross</div>
          <div className="bp-alloc">
            {alloc.filter((a) => a.v > 0).map((a) => (
              <div key={a.k} style={{ width: `${(a.v / allocTotal) * 100}%`, background: a.c }}>
                {(a.v / allocTotal) > 0.09 ? money(a.v) : ""}
              </div>
            ))}
          </div>
          <div className="bp-key">
            {alloc.filter((a) => a.v > 0).map((a) => (
              <span key={a.k}><i style={{ background: a.c }} />{a.k} {money(a.v)}</span>
            ))}
          </div>
        </div>

        {/* net worth */}
        <div className="bp-card">
          <div className="bp-eyebrow">Net worth by return scenario</div>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={netWorthData} margin={{ top: 6, right: 8, bottom: 0, left: 4 }}>
                <CartesianGrid stroke="#C7CDBF" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fontFamily: "ui-monospace, monospace", fill: "#6E7A72" }}
                  interval={Math.max(0, Math.floor(netWorthData.length / 8))} tickLine={false} stroke="#C7CDBF" />
                <YAxis tickFormatter={moneyK} width={54} tickLine={false} stroke="#C7CDBF"
                  tick={{ fontSize: 10, fontFamily: "ui-monospace, monospace", fill: "#6E7A72" }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(v)} />
                <Legend wrapperStyle={{ fontSize: 11, fontFamily: "ui-monospace, monospace" }} />
                <ReferenceLine y={0} stroke="#1B2430" />
                {scenarios.map((s) => (
                  <Line key={s.id} type="monotone" dataKey={s.name} stroke={s.color} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* balances */}
        <div className="bp-card">
          <div className="bp-eyebrow">Balances over time — {baseScenario?.name} scenario</div>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cashData} margin={{ top: 6, right: 8, bottom: 0, left: 4 }}>
                <CartesianGrid stroke="#C7CDBF" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fontFamily: "ui-monospace, monospace", fill: "#6E7A72" }}
                  interval={Math.max(0, Math.floor(cashData.length / 8))} tickLine={false} stroke="#C7CDBF" />
                <YAxis tickFormatter={moneyK} width={54} tickLine={false} stroke="#C7CDBF"
                  tick={{ fontSize: 10, fontFamily: "ui-monospace, monospace", fill: "#6E7A72" }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(v)} />
                <Legend wrapperStyle={{ fontSize: 11, fontFamily: "ui-monospace, monospace" }} />
                <ReferenceLine y={0} stroke="#B3261E" />
                <ReferenceLine y={num(solver.cashFloor)} stroke="#B3261E" strokeDasharray="4 4" />
                <Area type="monotone" dataKey="Cash" stackId="1" stroke="#0E7C86" fill="#9FC9C9" />
                <Area type="monotone" dataKey="Investments" stackId="1" stroke="#D9611A" fill="#EFC3A3" />
                <Area type="monotone" dataKey="Retirement" stackId="1" stroke="#2B4C9B" fill="#B6C4E4" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="bp-note">Dashed red line is your cash floor from the rent solver.</div>
        </div>

        {/* SOLVER — signature panel */}
        <div className="bp-card" style={{ borderWidth: 2, borderColor: "#1B2430" }}>
          <div className="bp-eyebrow">How much rent can I afford?</div>
          <div className="bp-fields">
            <Field label="Solve for">
              <select value={solverItem?.id || ""} onChange={(e) => setSolver({ itemId: e.target.value })}>
                {expenses.map((e) => <option key={e.id} value={e.id}>{e.name || "(unnamed)"}</option>)}
              </select>
            </Field>
            <Field label="Starting month">
              <MonthInput value={solver.fromMonth || absToYm(startAbs)} onChange={(v) => setSolver({ fromMonth: v })} />
            </Field>
            <Field label="Keep cash above">
              <NumInput value={solver.cashFloor} step={1000} onChange={(v) => setSolver({ cashFloor: v })} />
            </Field>
            <Field label={`End with at least (${settings.horizonMonths} mo)`}>
              <div className="bp-flex" style={{ flexWrap: "nowrap" }}>
                <input type="checkbox" checked={solver.useEndTarget}
                  onChange={(e) => setSolver({ useEndTarget: e.target.checked })} />
                <NumInput value={solver.endTarget} step={10000} onChange={(v) => setSolver({ endTarget: v })} />
              </div>
            </Field>
          </div>
          <div className="bp-flex" style={{ marginTop: 12 }}>
            <button className="bp-btn solid" onClick={runSolver}>Find the maximum</button>
            {solved && !solved.infeasible &&
              <button className="bp-btn" onClick={applySolved}>Use this amount</button>}
          </div>

          {solved && solved.infeasible && (
            <div className="bp-alert" style={{ marginTop: 14 }}>
              No rent works here — even at $0 the plan breaks
              {solved.reason === "cash"
                ? ` your ${money(solved.floor)} cash floor.`
                : ` your ${money(solved.target)} ending target.`}{" "}
              Cut other costs, raise income, or relax the constraint.
            </div>
          )}

          {solved && !solved.infeasible && (
            <>
              <div className="bp-gauge">
                <div className="bp-band" style={{ left: 0, width: `${Math.min(100, (solved.value / gaugeMax) * 100)}%`, background: "#C9DAD3" }} />
                <div className="bp-band" style={{ left: `${Math.min(100, (solved.value / gaugeMax) * 100)}%`, right: 0, background: "#EED9DA" }} />
                <div className="bp-mark" style={{ left: `${Math.min(100, (solved.value / gaugeMax) * 100)}%`, background: "#1B2430", height: 44 }}>
                  <span><strong>{money(Math.floor(solved.value / 25) * 25)}</strong> max</span>
                </div>
                {solved.current > 0 && (
                  <div className="bp-mark" style={{ left: `${Math.min(100, (solved.current / gaugeMax) * 100)}%`, background: "#D9611A", height: 22 }}>
                    <span style={{ bottom: 24, color: "#D9611A" }}>now {moneyK(solved.current)}</span>
                  </div>
                )}
              </div>
              <div className="bp-gticks"><span>$0</span><span>{money(gaugeMax / 2)}</span><span>{money(gaugeMax)}</span></div>
              <div className="bp-note">
                From {solved.fromM}, the most you can pay for {solved.name} is{" "}
                <strong style={{ color: "var(--ink)" }}>{money(Math.floor(solved.value / 25) * 25)}/mo</strong>
                {solved.current > 0 && solved.current !== solved.value &&
                  <> — {solved.value > solved.current
                    ? `${money(solved.value - solved.current)} more than you have budgeted`
                    : `${money(solved.current - solved.value)} less than you have budgeted`}</>}.
                Binding constraint: {solved.binding}. Cash bottoms out at {money(solved.minCash)}; you end with {money(solved.endTotal)}.
                The line's own schedule stays in force: "&#177; by" changes stack on top of this amount, a later
                "set to" replaces it, and the start/end window still applies.
              </div>
            </>
          )}
        </div>

        {/* TABS */}
        <div className="bp-tabs">
          {[["expenses", "Expenses"], ["income", "Income"], ["onetime", "One-time"],
            ["accounts", "Accounts & 401(k)"],
            ["whatif", `What-if${variantsList.filter((v) => v.applied).length ? ` (${variantsList.filter((v) => v.applied).length} on)` : ""}`],
            ["sense", "Sensitivity"],
            ["settings", "Taxes & scenarios"], ["table", "Year by year"]]
            .map(([k, l]) => (
              <button key={k} className="bp-tab" data-on={tab === k ? "1" : "0"} onClick={() => setTab(k)}>{l}</button>
            ))}
        </div>

        {tab === "expenses" && (
          <div className="bp-card" style={{ marginTop: 0, borderTop: "none" }}>
            <div className="bp-eyebrow">Recurring costs</div>
            <ItemList items={expenses} setItems={(v) => patch({ expenses: v })}
              addLabel="Add an expense" monthLabel="Total, first month" startAbs={startAbs} />
            <div className="bp-flex" style={{ marginTop: 10 }}>
              <button className="bp-btn ghost" onClick={() => patch({
                expenses: expenses.map((e) => ({ ...e, growth: num(settings.inflation) })),
              })}>Apply {settings.inflation}% inflation to all</button>
              <span className="bp-hint">The <strong>…</strong> button opens dates and scheduled changes for a line.</span>
            </div>
          </div>
        )}

        {tab === "income" && (
          <div className="bp-card" style={{ marginTop: 0, borderTop: "none" }}>
            <div className="bp-eyebrow">Gross monthly income</div>
            <ItemList items={incomes} setItems={(v) => patch({ incomes: v })} income
              addLabel="Add income" monthLabel="Total gross, first month" startAbs={startAbs} />
            <div className="bp-note">
              Enter gross pay before tax. If you file jointly, add your spouse's gross as a second line —
              taxes are computed on the combined total. For a partner who files separately, enter their
              take-home and mark the line "post-tax" (in its "…" panel) so it skips your tax return
              and 401(k) math. Use a scheduled change for a raise, a new job, or a start date.
            </div>
          </div>
        )}

        {tab === "onetime" && (
          <div className="bp-card" style={{ marginTop: 0, borderTop: "none" }}>
            <div className="bp-eyebrow">One-time money in and out</div>
            {oneTimes.map((o, i) => {
              const upd = (p) => patch({ oneTimes: oneTimes.map((x) => x.id === o.id ? { ...x, ...p } : x) });
              const linked = o.basis === "pct";
              const linkedItem = linked ? expenses.find((e) => e.id === o.itemId) : null;
              return (
                <div {...dragOneTimes.rowProps(o.id)} key={o.id} style={o.disabled ? { opacity: 0.5 } : undefined}>
                  <div className="bp-grid bp-onetime">
                    <div>{i === 0 && <label className="bp-lab">What</label>}
                      <TextInput value={o.name} placeholder="e.g. deposit"
                        onChange={(v) => upd({ name: v })} /></div>
                    <div>{i === 0 && <label className="bp-lab">Month</label>}
                      <MonthInput value={o.month} onChange={(v) => upd({ month: v })} /></div>
                    <div>{i === 0 && <label className="bp-lab">Amount</label>}
                      <div className="bp-flex" style={{ flexWrap: "nowrap", gap: 4 }}>
                        <select value={linked ? "pct" : "fixed"} style={{ width: 52 }}
                          title="A dollar amount, or a percentage of an expense line's rate that month"
                          onChange={(e) => upd({ basis: e.target.value === "pct" ? "pct" : "fixed" })}>
                          <option value="fixed">$</option><option value="pct">%</option>
                        </select>
                        {linked
                          ? <NumInput value={o.pct} step={25} onChange={(v) => upd({ pct: v })} />
                          : <NumInput value={o.amount} step={100} onChange={(v) => upd({ amount: v })} />}
                      </div></div>
                    <div>{i === 0 && <label className="bp-lab">Direction</label>}
                      <select value={o.kind} onChange={(e) => upd({ kind: e.target.value })}>
                        <option value="in">Money in</option><option value="out">Money out</option>
                      </select></div>
                    <div className="bp-skip">
                      {i === 0 && <label className="bp-lab">Skip</label>}
                      <input type="checkbox" checked={!!o.disabled} title="Temporarily remove from the plan"
                        onChange={(e) => upd({ disabled: e.target.checked })} />
                    </div>
                    <Handle {...dragOneTimes.handleProps(o.id)} />
                    <button className="bp-x" onClick={() => patch({ oneTimes: oneTimes.filter((x) => x.id !== o.id) })}>&#10005;</button>
                  </div>
                  {linked && (
                    <div className="bp-flex" style={{ marginTop: 6 }}>
                      <span className="bp-hint">of</span>
                      <select value={o.itemId || ""} style={{ width: "auto" }}
                        onChange={(e) => upd({ itemId: e.target.value })}>
                        <option value="">— pick an expense —</option>
                        {expenses.map((e) => <option key={e.id} value={e.id}>{e.name || "(unnamed)"}</option>)}
                      </select>
                      <span className="bp-hint">
                        {linkedItem
                          ? <>= {money(oneTimeAmount(o, expenses, ymToAbs(o.month) ?? startAbs, startAbs))} at that month's rate</>
                          : "pick the expense this is a percentage of"}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="bp-flex" style={{ marginTop: 12 }}>
              <button className="bp-btn" onClick={() => patch({
                oneTimes: [...oneTimes, { id: uid(), name: "", month: absToYm(startAbs), amount: 0, kind: "out" }],
              })}>+ Add a one-time item</button>
              <button className="bp-btn ghost"
                title="Reorders the list by each item's resolved dollar amount (% items use the linked expense in their month); skipped items go last. Click again to flip direction."
                onClick={() => {
                  const key = (o) => (o.disabled ? -1 : oneTimeAmount(o, expenses, ymToAbs(o.month) ?? startAbs, startAbs));
                  const dir = otSortDesc ? 1 : -1;
                  patch({ oneTimes: [...oneTimes].sort((a, b) => (key(b) - key(a)) * dir) });
                  setOtSortDesc(!otSortDesc);
                }}>
                Sort by amount {otSortDesc ? "↓" : "↑"}
              </button>
            </div>
            <div className="bp-note">
              Relocation lump sums are usually taxed as income. Enter the gross as money in and the extra tax as
              money out, or just enter the net amount you expect to keep. A "%" item tracks an expense line —
              200% of rent in the move month covers a deposit plus first month, and it follows the rent if the
              solver or a scheduled change moves it.
            </div>
          </div>
        )}

        {tab === "accounts" && (
          <div className="bp-card" style={{ marginTop: 0, borderTop: "none" }}>
            <div className="bp-eyebrow">401(k)</div>
            <div className="bp-fields">
              <Field label="Contribution style">
                <select value={settings.mode401k || "pct"} onChange={(e) => setSettings({ mode401k: e.target.value })}>
                  <option value="pct">% of gross pay</option>
                  <option value="maxEven">Max the limit, split evenly</option>
                </select></Field>
              {settings.mode401k === "maxEven"
                ? <Field label="$ / month (first month)">
                    <input value={money(m0.c401 || 0)} readOnly style={{ color: "#6E7A72" }} /></Field>
                : <Field label="You contribute (% of gross)">
                    <NumInput value={settings.pct401k} step={1} onChange={(v) => setSettings({ pct401k: v })} /></Field>}
              <Field label="Annual limit">
                <NumInput value={settings.limit401k} step={500} onChange={(v) => setSettings({ limit401k: v })} /></Field>
              <Field label="Already contributed this year">
                <NumInput value={settings.ytd401k} step={500} onChange={(v) => setSettings({ ytd401k: v })} /></Field>
              <Field label="Employer matches (%)">
                <NumInput value={settings.matchPct} step={5} onChange={(v) => setSettings({ matchPct: v })} /></Field>
              <Field label="...up to (% of gross)">
                <NumInput value={settings.matchCapPct} step={1} onChange={(v) => setSettings({ matchCapPct: v })} /></Field>
            </div>
            <div className="bp-note">
              This month: {money(m0.c401 || 0)} from you plus {money(m0.match || 0)} matched. Contributions are pre-tax
              and stop for the year once the limit is hit. "Already contributed this year" counts against the limit in
              the first calendar year only — use it when the plan starts mid-year.
              {settings.mode401k === "maxEven" && <> Even split spreads what is left of the limit evenly over the
              months remaining in each calendar year (never more than a month's gross, with later months catching up),
              so the limit lands exactly in December; the match is based on the percentage of gross that actually
              goes in.</>}
            </div>

            <div className="bp-eyebrow" style={{ marginTop: 22 }}>Accounts</div>
            {accounts.map((a, i) => {
              const upd = (p) => patch({ accounts: accounts.map((x) => x.id === a.id ? { ...x, ...p } : x) });
              return (
                <div {...dragAccounts.rowProps(a.id)} key={a.id}>
                  <div className="bp-grid bp-acct">
                    <div>{i === 0 && <label className="bp-lab">Account</label>}
                      <TextInput value={a.name} onChange={(v) => upd({ name: v })} placeholder="Account name" /></div>
                    <div>{i === 0 && <label className="bp-lab">Kind</label>}
                      <select value={a.type} onChange={(e) => upd({ type: e.target.value })}>
                        <option value="cash">Cash / savings</option>
                        <option value="invest">Investment</option>
                        <option value="retirement">Retirement</option>
                      </select></div>
                    <div>{i === 0 && <label className="bp-lab">Balance now</label>}
                      <NumInput value={a.balance} step={1000} onChange={(v) => upd({ balance: v })} /></div>
                    <div>{i === 0 && <label className="bp-lab">Return</label>}
                      <div className="bp-flex" style={{ flexWrap: "nowrap", gap: 4 }}>
                        <select value={a.returnMode} onChange={(e) => upd({ returnMode: e.target.value })}
                          style={{ width: 46 }} title="Fixed rate, or follow the scenario return">
                          <option value="fixed">%</option><option value="scenario">S</option>
                        </select>
                        {a.returnMode === "fixed"
                          ? <NumInput value={a.fixedRate} step={0.25} onChange={(v) => upd({ fixedRate: v })} />
                          : <input value="scenario" readOnly style={{ color: "#6E7A72" }} />}
                      </div></div>
                    <div>{i === 0 && <label className="bp-lab">Monthly deposit</label>}
                      <div className="bp-flex" style={{ flexWrap: "nowrap", gap: 4 }}>
                        <select value={a.contribMode} onChange={(e) => upd({ contribMode: e.target.value })}
                          style={{ width: 52 }}
                          title="$ = fixed amount every month. % = share of that month's leftover (after taxes, expenses and one-times) — transfers nothing in a shortfall month.">
                          <option value="none">—</option><option value="fixed">$</option><option value="pct">%</option>
                        </select>
                        {a.contribMode === "none"
                          ? <input value={a.primary ? "leftover" : "none"} readOnly style={{ color: "#6E7A72" }} />
                          : <NumInput value={a.contrib} step={a.contribMode === "pct" ? 1 : 100} onChange={(v) => upd({ contrib: v })} />}
                      </div></div>
                    <Handle {...dragAccounts.handleProps(a.id)} />
                    <button className="bp-x" onClick={() => patch({ accounts: accounts.filter((x) => x.id !== a.id) })}>&#10005;</button>
                  </div>
                  <div className="bp-flex" style={{ marginTop: 6 }}>
                    <label className="bp-hint" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" checked={!!a.primary}
                        onChange={() => patch({ accounts: accounts.map((x) => ({ ...x, primary: x.id === a.id })) })} />
                      Leftover money lands here
                    </label>
                    {a.type === "retirement" && <span className="bp-hint">· receives 401(k) contributions and match</span>}
                    {a.type !== "retirement" && (
                      <span className="bp-hint" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        · holds at most
                        <span style={{ width: 96 }}>
                          <NumInput value={a.capAmount ?? 0} step={1000} title="0 = no cap"
                            onChange={(v) => upd({ capAmount: v })} /></span>
                        then overflow to
                        <select value={a.overflowTo || ""} style={{ width: "auto" }}
                          onChange={(e) => upd({ overflowTo: e.target.value })}>
                          <option value="">— nowhere —</option>
                          {accounts.filter((x) => x.id !== a.id).map((x) =>
                            <option key={x.id} value={x.id}>{x.name || "(unnamed)"}</option>)}
                        </select>
                        {a.overflowTo && <>
                          starting
                          <span style={{ width: 128 }} title="Cap and backstop are dormant before this month; empty = from the beginning">
                            <MonthInput value={a.overflowStart || ""} onChange={(v) => upd({ overflowStart: v })} />
                          </span>
                          <label style={{ display: "flex", gap: 4, alignItems: "center" }}
                            title="A month that dips below the cap pulls money back from the overflow destination to refill it — without this, the backstop only rescues a balance about to go negative">
                            <input type="checkbox" checked={!!a.refillToCap}
                              onChange={(e) => upd({ refillToCap: e.target.checked })} />
                            refill to cap
                          </label>
                        </>}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            <div style={{ marginTop: 12 }}>
              <button className="bp-btn" onClick={() => patch({
                accounts: [...accounts, {
                  id: uid(), name: "New account", type: "invest", balance: 0,
                  returnMode: "scenario", fixedRate: 7, contribMode: "fixed", contrib: 0, primary: false,
                  capAmount: 0, overflowTo: "",
                }],
              })}>+ Add an account</button>
            </div>
            <div className="bp-note">
              "%" return means a fixed rate you set. "S" means the account follows whichever return scenario is being
              drawn, so you can see the same plan under different markets. A "%" monthly deposit is a share of that
              month's leftover money (take-home plus one-times minus costs), so lean months transfer less and shortfall
              months transfer nothing; a "$" deposit moves the full amount regardless. "Holds at most" caps an account's balance:
              anything above the cap spills into the overflow account at the end of each month — set a cap on the
              leftover account to keep a cash cushion and invest the rest. Caps can chain (cash → bonds → stocks).
              The link also works as a backstop: a month that would drive the account negative pulls money back from
              the overflow account (and on down the chain) just enough to reach $0. Dips below the cap are otherwise
              rebuilt from future leftovers, not by selling.
            </div>
          </div>
        )}

        {tab === "whatif" && (
          <div className="bp-card" style={{ marginTop: 0, borderTop: "none" }}>
            <div className="bp-eyebrow">What-if scenarios — side by side against the current plan</div>
            {whatif && whatif.length > 1 ? (
              <div className="bp-tblwrap">
                <table>
                  <thead>
                    <tr>
                      <th>Scenario</th><th>Spend, month 1</th><th>Trough cash</th><th>&#916; trough</th>
                      <th>End net worth</th><th>&#916; end</th>
                      {showMaxRent && <><th>Max {solverItem?.name || "rent"}</th><th>&#916;</th></>}
                    </tr>
                  </thead>
                  <tbody>
                    {whatif.map((row, i) => {
                      const b = whatif[0];
                      const d = (v, bv) => (i === 0 ? "—" : `${v - bv >= 0 ? "+" : "−"}${money(Math.abs(v - bv))}`);
                      return (
                        <tr key={row.id}>
                          <td>{row.name}</td>
                          <td>{money(row.firstExp)}</td>
                          <td>{money(row.trough)} <span className="bp-hint">{absLabel(row.troughAbs)}</span></td>
                          <td>{d(row.trough, b.trough)}</td>
                          <td>{money(row.endTotal)}</td>
                          <td>{d(row.endTotal, b.endTotal)}</td>
                          {showMaxRent && <>
                            <td>{Number.isNaN(row.maxRent) ? "infeasible" : money(row.maxRent)}</td>
                            <td>{i === 0 || Number.isNaN(row.maxRent) || Number.isNaN(b.maxRent) ? "—" : d(row.maxRent, b.maxRent)}</td>
                          </>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="bp-note">No scenarios yet — add one below and it will be simulated against the plan.</div>
            )}
            <label className="bp-hint" style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10 }}>
              <input type="checkbox" checked={showMaxRent} onChange={(e) => setShowMaxRent(e.target.checked)} />
              include a max-{(solverItem?.name || "rent").toLowerCase()} column (runs the solver per scenario,
              with the solver panel's floor and starting month)
            </label>
            <div className="bp-note">
              Scenarios are overlays on the live plan — edit any expense or income and every row recomputes.
              Checking "applied" folds a scenario into the plan everywhere (charts, readouts, solver) without
              touching the expense lines; its row then shows the plan <em>without</em> it, so every delta reads
              as "what toggling this checkbox does". "Bake into plan" makes it permanent. Trough cash is the
              lowest point before the first overflow link starts (the drawdown bottom that cap-skimming later
              hides); end net worth uses the {baseScenario?.name || "headline"} scenario. A "&#177; by" tweak
              lasts until the line's next "set to" change, like any delta.
            </div>

            {variantsList.map((v) => (
              <div key={v.id} style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--rule)" }}>
                <div className="bp-flex">
                  <label className="bp-hint" style={{ display: "flex", gap: 4, alignItems: "center" }}
                    title="Overlay this scenario on the live plan — charts, readouts, and the solver all include it while the expense lines stay untouched. Uncheck to revert.">
                    <input type="checkbox" checked={!!v.applied}
                      onChange={(e) => setVariants(variantsList.map((x) => (x.id === v.id ? { ...x, applied: e.target.checked } : x)))} />
                    applied
                  </label>
                  <span style={{ flex: "1 1 220px" }}>
                    <TextInput value={v.name} placeholder="Scenario name"
                      onChange={(nm) => setVariants(variantsList.map((x) => (x.id === v.id ? { ...x, name: nm } : x)))} />
                  </span>
                  <span className="bp-hint">starting</span>
                  <span style={{ width: 128 }}
                    title="Slides the whole scenario at once: default for tweaks without their own month, and a floor for the rest — a tweak dated later keeps its later date. Empty = each tweak's own month.">
                    <MonthInput value={v.startMonth || ""}
                      onChange={(nv) => setVariants(variantsList.map((x) => (x.id === v.id ? { ...x, startMonth: nv } : x)))} />
                  </span>
                  <button className="bp-btn" onClick={() => bakeVariant(v)}
                    title="Permanently write these tweaks into the expense lines as scheduled changes and drop the scenario">
                    Bake into plan
                  </button>
                  <button className="bp-x" title="Remove scenario"
                    onClick={() => setVariants(variantsList.filter((x) => x.id !== v.id))}>&#10005;</button>
                </div>
                {(v.tweaks || []).map((t) => (
                  <div key={t.id} className="bp-flex" style={{ marginTop: 6, paddingLeft: 12 }}>
                    <select value={t.itemId || ""} onChange={(e) => setTweak(v, t, { itemId: e.target.value })}>
                      <option value="">— expense —</option>
                      {expenses.map((e2) => <option key={e2.id} value={e2.id}>{e2.name || "(unnamed)"}</option>)}
                    </select>
                    <select value={t.mode === "delta" ? "delta" : "set"}
                      onChange={(e) => setTweak(v, t, { mode: e.target.value })}>
                      <option value="set">set to</option>
                      <option value="delta">&#177; by</option>
                    </select>
                    <span style={{ width: 110 }}>
                      <NumInput value={t.amount} step={10} onChange={(nv) => setTweak(v, t, { amount: nv })} />
                    </span>
                    <span style={{ width: 128 }} title="Empty = from the first simulated month">
                      <MonthInput value={t.startMonth || ""} onChange={(nv) => setTweak(v, t, { startMonth: nv })} />
                    </span>
                    <button className="bp-x" title="Remove tweak"
                      onClick={() => setVariants(variantsList.map((x) => x.id === v.id
                        ? { ...x, tweaks: (x.tweaks || []).filter((y) => y.id !== t.id) } : x))}>&#10005;</button>
                  </div>
                ))}
                <div style={{ paddingLeft: 12, marginTop: 6 }}>
                  <button className="bp-btn ghost" onClick={() => setVariants(variantsList.map((x) => x.id === v.id
                    ? { ...x, tweaks: [...(x.tweaks || []), { id: uid(), itemId: expenses[0]?.id || "", mode: "set", amount: 0, startMonth: "" }] }
                    : x))}>
                    + Add a tweak
                  </button>
                </div>
              </div>
            ))}
            <div style={{ marginTop: 12 }}>
              <button className="bp-btn"
                onClick={() => setVariants([...variantsList, { id: uid(), name: "", tweaks: [] }])}>
                + Add a scenario
              </button>
            </div>
          </div>
        )}

        {tab === "sense" && (
          <div className="bp-card" style={{ marginTop: 0, borderTop: "none" }}>
            <div className="bp-eyebrow">Sensitivity — sweep one or two items and watch the outputs</div>
            <div className="bp-fields">
              <Field label="Vary">
                <select value={sens.a ? `${sens.a.kind}:${sens.a.itemId}` : ""} onChange={(e) => pickSensAxis("a", e.target.value)}>
                  <option value="">— pick an item —</option>
                  <optgroup label="Income">
                    {incomes.map((x) => <option key={x.id} value={`income:${x.id}`}>{x.name || "(unnamed)"}</option>)}
                  </optgroup>
                  <optgroup label="Expenses">
                    {expenses.map((x) => <option key={x.id} value={`expense:${x.id}`}>{x.name || "(unnamed)"}</option>)}
                  </optgroup>
                  <optgroup label="One-time">
                    {oneTimes.map((x) => <option key={x.id} value={`onetime:${x.id}`}>{x.name || "(unnamed)"}</option>)}
                  </optgroup>
                </select>
              </Field>
              {sens.a && <>
                <Field label="From"><NumInput value={sens.a.min} step={500} onChange={(v) => setSensAxis("a", { min: v })} /></Field>
                <Field label="To"><NumInput value={sens.a.max} step={500} onChange={(v) => setSensAxis("a", { max: v })} /></Field>
                <Field label="Steps"><NumInput value={sens.a.steps} step={1} onChange={(v) => setSensAxis("a", { steps: v })} /></Field>
              </>}
            </div>
            <div className="bp-fields" style={{ marginTop: 8 }}>
              <Field label="And (optional)">
                <select value={sens.b ? `${sens.b.kind}:${sens.b.itemId}` : ""} onChange={(e) => pickSensAxis("b", e.target.value)}>
                  <option value="">— nothing —</option>
                  <optgroup label="Income">
                    {incomes.map((x) => <option key={x.id} value={`income:${x.id}`}>{x.name || "(unnamed)"}</option>)}
                  </optgroup>
                  <optgroup label="Expenses">
                    {expenses.map((x) => <option key={x.id} value={`expense:${x.id}`}>{x.name || "(unnamed)"}</option>)}
                  </optgroup>
                  <optgroup label="One-time">
                    {oneTimes.map((x) => <option key={x.id} value={`onetime:${x.id}`}>{x.name || "(unnamed)"}</option>)}
                  </optgroup>
                </select>
              </Field>
              {sens.b && <>
                <Field label="From"><NumInput value={sens.b.min} step={500} onChange={(v) => setSensAxis("b", { min: v })} /></Field>
                <Field label="To"><NumInput value={sens.b.max} step={500} onChange={(v) => setSensAxis("b", { max: v })} /></Field>
                <Field label="Lines (2–5)"><NumInput value={sens.b.steps} step={1} onChange={(v) => setSensAxis("b", { steps: v })} /></Field>
              </>}
            </div>
            <div className="bp-flex" style={{ marginTop: 12 }}>
              <button className="bp-btn solid" disabled={!sens.a?.itemId || sensBusy} onClick={runSens}>
                {sensBusy ? "Computing…" : "Run analysis"}
              </button>
              {sensBusy && <span className="bp-hint">running the solver across the grid…</span>}
            </div>
            <div className="bp-note">
              Each grid point reruns the rent solver (its floor and starting month) at the
              {" "}{baseScenario?.name || "headline"} rate, with applied what-ifs included; both charts read
              that solve — end net worth is where you land if you actually pay the solved max. The sweep
              replaces the item's base amount; scheduled changes still fold on top. Gaps mean even $0 fails
              the floor.
            </div>

            {sensCharts && <>
              <div className="bp-eyebrow" style={{ marginTop: 18 }}>Max {solverItem?.name || "rent"} vs {sensCharts.aName}</div>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <LineChart data={sensCharts.data} margin={{ top: 8, right: 18, bottom: 4, left: 4 }}>
                    <CartesianGrid stroke="#E3E6DD" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="a" type="number" domain={["dataMin", "dataMax"]} tickFormatter={moneyK}
                      tickLine={false} stroke="#C7CDBF" tick={{ fontSize: 10, fontFamily: "ui-monospace, monospace", fill: "#6E7A72" }} />
                    <YAxis tickFormatter={moneyK} width={54} tickLine={false} stroke="#C7CDBF"
                      tick={{ fontSize: 10, fontFamily: "ui-monospace, monospace", fill: "#6E7A72" }} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(v)}
                      labelFormatter={(l) => `${sensCharts.aName}: ${money(l)}`} />
                    {sensCharts.multi && <Legend wrapperStyle={{ fontSize: 11, fontFamily: "ui-monospace, monospace" }} />}
                    {sensCharts.currentA > 0 && <ReferenceLine x={sensCharts.currentA} stroke="#8A94A6" strokeDasharray="4 4" />}
                    {sensCharts.seriesKeys.map((k, j) => (
                      <Line key={k} type="monotone" dataKey={`rent:${k}`}
                        name={sensCharts.multi ? `${sensCharts.bName} ${k}` : `Max ${solverItem?.name || "rent"}`}
                        stroke={sensCharts.color(j, "#0E7C86")} strokeWidth={2}
                        dot={{ r: 2.5 }} activeDot={{ r: 5 }} isAnimationActive={false} connectNulls={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="bp-eyebrow" style={{ marginTop: 14 }}>End net worth at that max vs {sensCharts.aName}</div>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <LineChart data={sensCharts.data} margin={{ top: 8, right: 18, bottom: 4, left: 4 }}>
                    <CartesianGrid stroke="#E3E6DD" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="a" type="number" domain={["dataMin", "dataMax"]} tickFormatter={moneyK}
                      tickLine={false} stroke="#C7CDBF" tick={{ fontSize: 10, fontFamily: "ui-monospace, monospace", fill: "#6E7A72" }} />
                    <YAxis tickFormatter={moneyK} width={54} tickLine={false} stroke="#C7CDBF"
                      tick={{ fontSize: 10, fontFamily: "ui-monospace, monospace", fill: "#6E7A72" }} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(v)}
                      labelFormatter={(l) => `${sensCharts.aName}: ${money(l)}`} />
                    {sensCharts.multi && <Legend wrapperStyle={{ fontSize: 11, fontFamily: "ui-monospace, monospace" }} />}
                    {sensCharts.currentA > 0 && <ReferenceLine x={sensCharts.currentA} stroke="#8A94A6" strokeDasharray="4 4" />}
                    {sensCharts.seriesKeys.map((k, j) => (
                      <Line key={k} type="monotone" dataKey={`end:${k}`}
                        name={sensCharts.multi ? `${sensCharts.bName} ${k}` : "End net worth"}
                        stroke={sensCharts.color(j, "#2B4C9B")} strokeWidth={2}
                        dot={{ r: 2.5 }} activeDot={{ r: 5 }} isAnimationActive={false} connectNulls={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="bp-note">
                Dashed gray line marks the item's current amount{sensCharts.multi ? "; darker lines are higher values of the second item" : ""}.
                Results are from the last run — hit "Run analysis" after editing the plan.
              </div>
            </>}
          </div>
        )}

        {tab === "settings" && (
          <div className="bp-card" style={{ marginTop: 0, borderTop: "none" }}>
            <div className="bp-eyebrow">Projection</div>
            <div className="bp-fields">
              <Field label="Start month"><MonthInput value={settings.startMonth} onChange={(v) => setSettings({ startMonth: v })} /></Field>
              <Field label="Months to project"><NumInput value={settings.horizonMonths} step={12} min={1} onChange={(v) => setSettings({ horizonMonths: v })} /></Field>
              <Field label="Inflation (%/yr)"><NumInput value={settings.inflation} step={0.5} onChange={(v) => setSettings({ inflation: v })} /></Field>
            </div>

            <div className="bp-eyebrow" style={{ marginTop: 22 }}>Taxes</div>
            <div className="bp-fields">
              <Field label="Filing status">
                <select value={settings.filing} onChange={(e) => setSettings({ filing: e.target.value })}>
                  <option value="single">Single</option><option value="married">Married, filing jointly</option>
                </select></Field>
              <Field label="State">
                <select value={settings.stateTax} onChange={(e) => setSettings({ stateTax: e.target.value })}>
                  <option value="CA">California</option><option value="custom">Flat state rate</option><option value="none">No state tax</option>
                </select></Field>
              {settings.stateTax === "custom" &&
                <Field label="State rate (%)"><NumInput value={settings.stateRate} step={0.5} onChange={(v) => setSettings({ stateRate: v })} /></Field>}
              <Field label="Override with one flat rate">
                <div className="bp-flex" style={{ flexWrap: "nowrap" }}>
                  <input type="checkbox" checked={settings.useFlatTax} onChange={(e) => setSettings({ useFlatTax: e.target.checked })} />
                  <NumInput value={settings.flatTaxRate} step={1} onChange={(v) => setSettings({ flatTaxRate: v })} />
                </div></Field>
            </div>
            <div className="bp-note">
              Estimated federal, state, Social Security and Medicare on {money((m0.gross || 0) * 12)}/yr:
              <strong> {money(m0.tax || 0)}/mo</strong>, an effective rate of {m0.gross ? ((m0.tax / m0.gross) * 100).toFixed(1) : 0}%.
              These are approximations using 2025 brackets and the standard deduction — no itemizing, credits, RSUs or
              bonuses. Check the number against a real paystub and use the flat-rate override if it is off.
            </div>

            <div className="bp-eyebrow" style={{ marginTop: 22 }}>Return scenarios</div>
            {scenarios.map((s, i) => (
              <div {...dragScenarios.rowProps(s.id)} key={s.id}>
                <div className="bp-grid" style={{ gridTemplateColumns: "1fr 90px 60px 26px 30px" }}>
                  <div><TextInput value={s.name}
                    onChange={(v) => patch({ scenarios: scenarios.map((x) => x.id === s.id ? { ...x, name: v } : x) })} /></div>
                  <div><NumInput value={s.rate} step={0.5}
                    onChange={(v) => patch({ scenarios: scenarios.map((x) => x.id === s.id ? { ...x, rate: v } : x) })} /></div>
                  <div><input type="color" value={s.color} style={{ padding: 0, height: 30 }}
                    onChange={(e) => patch({ scenarios: scenarios.map((x) => x.id === s.id ? { ...x, color: e.target.value } : x) })} /></div>
                  <Handle {...dragScenarios.handleProps(s.id)} />
                  <button className="bp-x" onClick={() => patch({ scenarios: scenarios.filter((x) => x.id !== s.id) })}>&#10005;</button>
                </div>
              </div>
            ))}
            <div className="bp-flex" style={{ marginTop: 12 }}>
              <button className="bp-btn" onClick={() => patch({
                scenarios: [...scenarios, { id: uid(), name: `Scenario ${scenarios.length + 1}`, rate: 5, color: "#2B4C9B" }],
              })}>+ Add a scenario</button>
              <button className="bp-btn ghost" onClick={() => { if (confirm("Replace everything with the starting example?")) setModel(makeDefaults()); }}>
                Reset to example
              </button>
            </div>
            <div className="bp-note">
              Rates are annual, compounded monthly, and nominal — subtract inflation if you want real returns.
              The second scenario in the list drives the headline numbers and the solver.
            </div>
          </div>
        )}

        {tab === "table" && (
          <div className="bp-card" style={{ marginTop: 0, borderTop: "none" }}>
            <div className="bp-eyebrow">Year by year — {baseScenario?.name} scenario</div>
            <div className="bp-tblwrap">
              <table>
                <thead>
                  <tr>
                    <th>Year</th><th>Take-home</th><th>Living costs</th><th>One-time</th>
                    <th>Saved</th><th>Cash</th><th>Investments</th><th>Retirement</th><th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {yearRows.map((y) => (
                    <tr key={y.year}>
                      <td>{y.year}</td>
                      <td>{money(y.net)}</td>
                      <td>{money(y.exp)}</td>
                      <td className={y.one < 0 ? "bp-neg" : ""}>{money(y.one)}</td>
                      <td>{money(y.saved)}</td>
                      <td className={y.last.cash < 0 ? "bp-neg" : ""}>{money(y.last.cash)}</td>
                      <td>{money(y.last.invest)}</td>
                      <td>{money(y.last.retire)}</td>
                      <td><strong>{money(y.last.total)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bp-note">Balances are end-of-year. Partial first year reflects only the months projected.</div>
          </div>
        )}

        <div className="bp-note" style={{ marginTop: 24, borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
          Everything here is an estimate for planning, not tax or investment advice. Your work saves in this browser
          automatically — use Export to keep a copy you can move somewhere else.
        </div>
      </div>
    </div>
  );
}
