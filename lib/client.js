window.__ModuleLoader__.load({
  id: "dsh-proactive-questioning",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/components.tsx
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/lifecycle.mjs
var ACTIVE_WINDOW_MS = 12e4;
function questionVisibility(askedAt, now = Date.now()) {
  return now - askedAt < ACTIVE_WINDOW_MS ? "active" : "bubble";
}
function questionRemainingSeconds(askedAt, now = Date.now()) {
  const elapsed = Math.max(0, now - askedAt);
  if (elapsed >= ACTIVE_WINDOW_MS) return void 0;
  return Math.ceil((ACTIVE_WINDOW_MS - elapsed) / 1e3);
}

// src/client/store.ts
var STORAGE_PREFIX = "dsh-proactive-questioning/v1/";
function keyFor(sessionId, callId, questionId) {
  return `${sessionId}:${callId}:${questionId}`;
}
function storageKey(sessionId, key) {
  return `${STORAGE_PREFIX}${encodeURIComponent(sessionId)}/${encodeURIComponent(key)}`;
}
function readStored(sessionId, key) {
  try {
    const text = window.localStorage.getItem(storageKey(sessionId, key));
    if (text === null) return void 0;
    const value = JSON.parse(text);
    if (typeof value?.askedAt !== "number" || !["open", "answered", "skipped"].includes(value.state)) return void 0;
    return { askedAt: value.askedAt, state: value.state };
  } catch {
    return void 0;
  }
}
function writeStored(entry) {
  try {
    window.localStorage.setItem(storageKey(entry.sessionId, entry.key), JSON.stringify({ askedAt: entry.askedAt, state: entry.state }));
  } catch {
  }
}
var QuestionStore = class {
  entries = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  snapshots = /* @__PURE__ */ new Map();
  timers = /* @__PURE__ */ new Map();
  /** One shared repaint clock, running only while something is actually open. */
  tickTimer;
  /** Bumped by every mutation; the render subscription's getSnapshot value. */
  version = 0;
  /** Monotonic mutation counter — a valid `useSyncExternalStore` snapshot. */
  get revision() {
    return this.version;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  snapshot(sessionId) {
    const cached = this.snapshots.get(sessionId);
    if (cached !== void 0) return cached;
    const next = [...this.entries.values()].filter((entry) => entry.sessionId === sessionId && entry.state === "open").sort((left, right) => left.askedAt - right.askedAt);
    this.snapshots.set(sessionId, next);
    return next;
  }
  /**
   * Resolve the session that has been waiting longest on an answer.
   *
   * Ties break on the entry key: two questions enqueued in the same
   * millisecond (one Agent step asking twice) would otherwise resolve in
   * insertion order, which depends on tool-call order rather than on anything
   * the user can see. Ordering by key keeps the choice stable across renders.
   */
  sessionWithOpenQuestion() {
    let oldest;
    for (const entry of this.entries.values()) {
      if (entry.state !== "open") continue;
      if (oldest === void 0 || entry.askedAt < oldest.askedAt || entry.askedAt === oldest.askedAt && entry.key < oldest.key) {
        oldest = { sessionId: entry.sessionId, askedAt: entry.askedAt, key: entry.key };
      }
    }
    return oldest?.sessionId;
  }
  enqueue(sessionId, callId, questions) {
    let changed = false;
    for (const question of questions) {
      const key = keyFor(sessionId, callId, question.id);
      const previous = this.entries.get(key);
      if (previous !== void 0) continue;
      const saved = readStored(sessionId, key);
      const entry = {
        key,
        sessionId,
        callId,
        question,
        askedAt: saved?.askedAt ?? Date.now(),
        state: saved?.state ?? "open"
      };
      this.entries.set(key, entry);
      writeStored(entry);
      this.scheduleVisibility(entry);
      changed = true;
    }
    if (changed) {
      this.syncTick();
      this.publish();
    }
  }
  close(entry, state) {
    const current = this.entries.get(entry.key);
    if (current === void 0 || current.state !== "open") return;
    const next = { ...current, state };
    this.entries.set(entry.key, next);
    writeStored(next);
    this.clearTimer(entry.key);
    this.prune(entry.sessionId);
    this.syncTick();
    this.publish();
  }
  skipAll(sessionId) {
    let changed = false;
    for (const entry of this.entries.values()) {
      if (entry.sessionId !== sessionId || entry.state !== "open") continue;
      const next = { ...entry, state: "skipped" };
      this.entries.set(entry.key, next);
      writeStored(next);
      this.clearTimer(entry.key);
      changed = true;
    }
    if (changed) {
      this.prune(sessionId);
      this.syncTick();
      this.publish();
    }
  }
  /**
   * Drop the records of one Session once nothing is left open there. The
   * durable transcript already owns the question text, and the browser only
   * mirrors "shown / answered / skipped", so a settled Session keeps no
   * entries — which is what stops the id-keyed ledger from growing for the
   * lifetime of the page.
   */
  prune(sessionId) {
    let removed = false;
    for (const [key, entry] of this.entries) {
      if (entry.sessionId === sessionId && entry.state !== "open") {
        this.entries.delete(key);
        removed = true;
      }
    }
    if (removed) this.snapshots.delete(sessionId);
  }
  /**
   * One timer marks the end of the newest-question accent window.
   *
   * It is deliberately `unref`'d where the host offers it: the timer exists
   * only to repaint an accent, so it must never be the reason a browser-less
   * host (a test process, a headless preview) stays alive after its work is
   * done.
   */
  scheduleVisibility(entry) {
    if (entry.state !== "open") return;
    const delay = Math.max(0, entry.askedAt + ACTIVE_WINDOW_MS - Date.now());
    const timer = setTimeout(() => {
      this.timers.delete(entry.key);
      this.publish();
    }, delay);
    const unref = timer.unref;
    if (typeof unref === "function") unref.call(timer);
    this.timers.set(entry.key, timer);
  }
  clearTimer(key) {
    const timer = this.timers.get(key);
    if (timer !== void 0) clearTimeout(timer);
    this.timers.delete(key);
  }
  /**
   * Keep one repaint clock alive exactly while something is open.
   *
   * The card shows a per-second countdown, so the store needs to republish on a
   * clock; `scheduleVisibility` cannot do it, being a single one-shot that
   * fires only when the accent window closes. Starting and stopping here — with
   * `enqueue`, `close` and `skipAll` as the only callers — means an idle page
   * with nothing pending runs no timer at all.
   *
   * `unref`'d for the same reason as `scheduleVisibility`: this exists to
   * repaint text, so it must never be why a browser-less host stays alive.
   * Browsers throttle a backgrounded tab's interval, which is expected — the
   * countdown is derived from `Date.now()`, so it shows the true remaining time
   * the moment the tab is visible again rather than having drifted.
   */
  syncTick() {
    const open = [...this.entries.values()].some((entry) => entry.state === "open");
    if (open && this.tickTimer === void 0) {
      const timer = setInterval(() => {
        this.publish();
      }, 1e3);
      const unref = timer.unref;
      if (typeof unref === "function") unref.call(timer);
      this.tickTimer = timer;
    } else if (!open && this.tickTimer !== void 0) {
      clearInterval(this.tickTimer);
      this.tickTimer = void 0;
    }
  }
  /** Drop every pending accent timer and the repaint clock. Used by tests and page teardown. */
  dispose() {
    for (const key of [...this.timers.keys()]) this.clearTimer(key);
    if (this.tickTimer !== void 0) {
      clearInterval(this.tickTimer);
      this.tickTimer = void 0;
    }
    this.listeners.clear();
  }
  publish() {
    this.version += 1;
    this.snapshots.clear();
    for (const listener of this.listeners) listener();
  }
};
var questionStore = new QuestionStore();

// src/client/components.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var PANEL = {
  border: "0.5px solid var(--dsw-alias-border-l1)",
  borderRadius: 12,
  background: "var(--dsw-specific-tip)",
  color: "var(--dsw-alias-label-primary)"
};
var CARD = {
  display: "flex",
  flexDirection: "column",
  width: "100%",
  padding: "0 0 10px",
  border: "0.5px solid var(--dsw-alias-border-l2-darkmode-thin)",
  borderRadius: 20,
  background: "var(--dsw-specific-input-major)",
  boxShadow: "var(--dsw-elevation-panel)",
  color: "var(--dsw-alias-label-primary)",
  overflow: "hidden"
};
var HEADER = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 16,
  padding: "20px 16px 0 24px"
};
var ICON_BUTTON = {
  display: "grid",
  placeItems: "center",
  width: 24,
  height: 24,
  padding: 0,
  border: "none",
  borderRadius: 999,
  background: "transparent",
  color: "var(--dsw-alias-label-tertiary)",
  cursor: "pointer"
};
var OPTION_ROW = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  width: "100%",
  minHeight: 40,
  flexShrink: 0,
  padding: "8px 12px 8px 8px",
  border: "1px solid transparent",
  borderRadius: 12,
  background: "transparent",
  color: "inherit",
  textAlign: "left",
  cursor: "pointer"
};
var INDICATOR = {
  display: "grid",
  placeItems: "center",
  flex: "0 0 20px",
  width: 20,
  height: 20,
  marginTop: 2,
  borderRadius: 6,
  background: "var(--dsw-alias-bg-overlay)",
  color: "var(--dsw-alias-label-secondary)",
  fontSize: 12,
  fontWeight: 500,
  lineHeight: "18px"
};
var FOOTER = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginTop: 12,
  padding: "0 10px 0 18px"
};
var READOUT = {
  color: "var(--dsw-alias-label-secondary)",
  fontSize: 14,
  lineHeight: "24px",
  fontWeight: 500,
  whiteSpace: "nowrap"
};
function parseRecommendedLabel(label) {
  const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i;
  return suffix.test(label) ? { label: label.replace(suffix, ""), recommended: true } : { label, recommended: false };
}
function Countdown({ askedAt }) {
  const remaining = questionRemainingSeconds(askedAt);
  (0, import_react.useEffect)(() => {
    if (remaining === void 0) questionStore.skipAll();
  }, [remaining]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "span",
    {
      "data-dsh-question-countdown": true,
      "data-state": remaining === void 0 ? "settled" : "counting",
      title: "\u65B0\u9C9C\u671F\u5269\u4F59\u65F6\u95F4\u3002\u5230\u671F\u540E\u95EE\u9898\u4ECD\u7136\u4FDD\u7559\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u5173\u95ED\u3002",
      "aria-label": remaining === void 0 ? "\u65B0\u9C9C\u671F\u5DF2\u8FC7\uFF0C\u95EE\u9898\u4ECD\u7136\u4FDD\u7559" : `\u65B0\u9C9C\u671F\u8FD8\u5269 ${String(remaining)} \u79D2`,
      style: { ...READOUT, fontSize: 12, color: "var(--dsw-alias-label-tertiary)" },
      children: remaining === void 0 ? "\u5DF2\u4FDD\u7559" : `${String(remaining)}s`
    }
  );
}
function questionsFrom(block) {
  const raw = readArgsRaw(block);
  if (typeof raw !== "string" || raw === "") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.questions)) return [];
    const ids = /* @__PURE__ */ new Set();
    const questions = [];
    for (const item of parsed.questions) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) return [];
      const record = item;
      if (typeof record.id !== "string" || record.id.trim() === "" || typeof record.question !== "string" || record.question.trim() === "" || ids.has(record.id)) return [];
      ids.add(record.id);
      const options = record.options === void 0 ? void 0 : Array.isArray(record.options) ? record.options.flatMap((option) => option !== null && typeof option === "object" && !Array.isArray(option) && typeof option.label === "string" ? [{
        label: option.label,
        ...typeof option.description === "string" ? { description: option.description } : {}
      }] : []) : void 0;
      if (record.options !== void 0 && options?.length !== record.options.length) return [];
      questions.push({
        id: record.id,
        question: record.question,
        ...typeof record.header === "string" ? { header: record.header } : {},
        ...options === void 0 ? {} : { options },
        ...record.multi_select === true ? { multiSelect: true } : {}
      });
    }
    return questions;
  } catch {
    return [];
  }
}
function readArgsRaw(block) {
  if (block === null || typeof block !== "object") return void 0;
  const candidate = block;
  return "kind" in candidate ? candidate.call?.argsRaw : candidate.argsRaw;
}
function useQuestions(sessionId) {
  const revision = (0, import_react.useSyncExternalStore)(
    (listener) => questionStore.subscribe(listener),
    () => questionStore.revision,
    () => 0
  );
  return (0, import_react.useMemo)(
    () => sessionId === void 0 ? [] : questionStore.snapshot(sessionId),
    // `revision` is the store's mutation counter: it republishes every
    // snapshot, so it is the only correctness input besides the identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revision, sessionId]
  );
}
function answerText(entry, selected, custom) {
  return [
    `\u5BF9\u975E\u963B\u585E\u95EE\u9898\u300C${entry.question.question}\u300D\u7684\u56DE\u7B54\uFF1A`,
    JSON.stringify({ questionId: `${entry.callId}:${entry.question.id}`, selected, ...custom === "" ? {} : { custom } }),
    "\u8BF7\u628A\u5B83\u4F5C\u4E3A\u540E\u7EED\u5EFA\u8BAE\u6216\u51B3\u7B56\u7684\u8F93\u5165\uFF1B\u4E4B\u524D\u7684\u5DE5\u4F5C\u4E0D\u9700\u8981\u91CD\u505A\u3002"
  ].join("\n");
}
function OptionRow({ index, label, description, selected, multiSelect, busy, onChoose }) {
  const display = parseRecommendedLabel(label);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "button",
    {
      type: "button",
      "data-dsh-question-option": true,
      "data-selected": selected ? "true" : "false",
      role: multiSelect ? "checkbox" : "radio",
      "aria-checked": selected,
      "aria-label": display.label,
      disabled: busy,
      onClick: onChoose,
      style: {
        ...OPTION_ROW,
        // Single-select keeps the selected row visibly committed; multi-select
        // reuses the same surface so both read as one control family.
        ...selected ? { background: "var(--dsw-alias-interactive-bg-hover)", borderColor: "var(--dsw-alias-border-l2)" } : {},
        cursor: busy ? "default" : "pointer"
      },
      children: [
        multiSelect ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CheckBox, { checked: selected }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": true, style: INDICATOR, children: index + 1 }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { minWidth: 0, flex: 1, display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "2px 6px" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 14, lineHeight: "24px", fontWeight: 500 }, children: display.label }),
          display.recommended ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: {
            padding: "0 4px",
            borderRadius: 6,
            fontSize: 11,
            lineHeight: "18px",
            fontWeight: 600,
            background: "var(--dsw-specific-sidebar-nav-item-active-accent)",
            color: "var(--dsw-alias-button-info-fill)"
          }, children: "\u63A8\u8350" }) : null,
          description === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 14, lineHeight: "24px" }, children: description })
        ] })
      ]
    }
  );
}
function CheckBox({ checked }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { "aria-hidden": true, style: { display: "grid", placeItems: "center", flex: "0 0 20px", width: 20, height: 20, marginTop: 2 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: {
      gridArea: "1 / 1",
      width: 14,
      height: 14,
      borderRadius: 4,
      border: `0.5px solid ${checked ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-border-l4)"}`,
      background: checked ? "var(--dsw-alias-label-primary)" : "transparent"
    } }),
    checked ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { gridArea: "1 / 1", display: "grid", placeItems: "center", color: "var(--dsw-alias-label-primary-foreground)" }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconCheckOutline14, { size: 12 }) }) : null
  ] });
}
function QuestionCard({ entry, send, expanded, index, total, onClose }) {
  const [selected, setSelected] = (0, import_react.useState)([]);
  const [custom, setCustom] = (0, import_react.useState)("");
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)("");
  const [submitted, setSubmitted] = (0, import_react.useState)(false);
  const options = entry.question.options ?? [];
  const multiSelect = entry.question.multiSelect === true;
  const canSubmit = selected.length > 0 || custom.trim() !== "";
  const locked = busy || submitted;
  const choose = (label) => {
    setSelected((previous) => multiSelect ? previous.includes(label) ? previous.filter((value) => value !== label) : [...previous, label] : previous.includes(label) ? [] : [label]);
  };
  const submit = async () => {
    if (!canSubmit || locked) return;
    setBusy(true);
    setError("");
    try {
      await send(answerText(entry, selected, custom.trim()));
      setSubmitted(true);
      questionStore.close(entry, "answered");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "\u56DE\u7B54\u672A\u80FD\u53D1\u9001\u5230\u6B64\u5BF9\u8BDD\u3002");
    } finally {
      setBusy(false);
    }
  };
  if (!expanded) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        role: "group",
        "aria-label": entry.question.question,
        style: { marginTop: 10, borderTop: "0.5px solid var(--dsw-alias-border-l1)", paddingTop: 10 },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 13, lineHeight: "20px", whiteSpace: "pre-wrap" }, children: entry.question.question }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }, children: options.map((option, optionIndex) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            OptionRow,
            {
              index: optionIndex,
              label: option.label,
              description: option.description,
              selected: selected.includes(option.label),
              multiSelect,
              busy: locked,
              onChoose: () => {
                choose(option.label);
              }
            },
            option.label
          )) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { marginTop: 8 }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "textarea",
            {
              "aria-label": "\u8865\u5145\u56DE\u7B54",
              value: custom,
              disabled: locked,
              onChange: (event) => {
                setCustom(event.currentTarget.value);
              },
              placeholder: "\u4E5F\u53EF\u4EE5\u4E0D\u9009\u9009\u9879\uFF0C\u76F4\u63A5\u5199\u60F3\u6CD5",
              style: {
                boxSizing: "border-box",
                width: "100%",
                minHeight: 56,
                padding: "7px 9px",
                fontSize: 13,
                lineHeight: "20px",
                resize: "vertical",
                outline: "none",
                color: "var(--dsw-alias-label-primary)",
                background: "var(--dsw-alias-bg-base)",
                border: "1px solid var(--dsw-alias-border-l2)",
                borderRadius: 8
              }
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 12, marginTop: 10 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", disabled: locked, onClick: () => {
              questionStore.close(entry, "skipped");
            }, children: "\u8DF3\u8FC7\u672C\u9898" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "primary", disabled: !canSubmit || locked, onClick: () => {
              void submit();
            }, children: busy ? "\u53D1\u9001\u4E2D\u2026" : submitted ? "\u5DF2\u63D0\u4EA4" : "\u63D0\u4EA4" })
          ] }),
          error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", style: { margin: "8px 0 0", fontSize: 13, color: "var(--dsw-alias-state-error-primary)" }, children: error }) : null
        ]
      }
    );
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "section",
    {
      "data-dsh-question-card": true,
      "aria-labelledby": `dsh-question-${entry.key}`,
      style: { ...CARD, marginTop: 10 },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { style: HEADER, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { minWidth: 0 }, children: [
            entry.question.header === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { marginBottom: 5, color: "var(--dsw-alias-label-tertiary)", fontSize: 11, lineHeight: "16px" }, children: entry.question.header }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { id: `dsh-question-${entry.key}`, style: { margin: 0, fontSize: 16, lineHeight: "22px", fontWeight: 500 }, children: entry.question.question })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Countdown, { askedAt: entry.askedAt }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                style: ICON_BUTTON,
                disabled: locked,
                "aria-label": "\u6536\u8D77\u8349\u7A3F\uFF08\u95EE\u9898\u4ECD\u4FDD\u7559\uFF0C\u53EF\u968F\u65F6\u56DE\u6765\u56DE\u7B54\uFF09",
                title: "\u6536\u8D77\u8349\u7A3F\uFF08\u95EE\u9898\u4ECD\u4FDD\u7559\uFF0C\u53EF\u968F\u65F6\u56DE\u6765\u56DE\u7B54\uFF09",
                onClick: onClose,
                children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconCloseOutline16, {})
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 1, margin: "8px 0 0", padding: "4px 12px" }, children: [
          options.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "div",
            {
              role: multiSelect ? "group" : "radiogroup",
              "aria-label": multiSelect ? "\u53EF\u591A\u9009" : "\u5355\u9009",
              children: options.map((option, optionIndex) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                OptionRow,
                {
                  index: optionIndex,
                  label: option.label,
                  description: option.description,
                  selected: selected.includes(option.label),
                  multiSelect,
                  busy: locked,
                  onChoose: () => {
                    choose(option.label);
                  }
                },
                option.label
              ))
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: {
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            width: "100%",
            minHeight: 40,
            flexShrink: 0,
            padding: "8px 12px 8px 8px",
            border: `1px solid ${custom === "" ? "transparent" : "var(--dsw-alias-border-l2)"}`,
            borderRadius: 12,
            background: custom === "" ? "transparent" : "var(--dsw-alias-interactive-bg-hover)"
          }, children: [
            multiSelect ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CheckBox, { checked: custom !== "" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": true, style: INDICATOR, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconEditOutline16, { size: 12 }) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "textarea",
              {
                "aria-label": "\u8865\u5145\u56DE\u7B54",
                value: custom,
                disabled: locked,
                onChange: (event) => {
                  setCustom(event.currentTarget.value);
                },
                placeholder: "\u4E5F\u53EF\u4EE5\u4E0D\u9009\u9009\u9879\uFF0C\u76F4\u63A5\u5199\u60F3\u6CD5",
                style: {
                  flex: 1,
                  minWidth: 0,
                  minHeight: 32,
                  padding: 0,
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  resize: "vertical",
                  font: "inherit",
                  fontSize: 14,
                  lineHeight: "24px",
                  color: "var(--dsw-alias-label-primary)",
                  caretColor: "var(--dsw-alias-state-business-primary)"
                }
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("footer", { style: FOOTER, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                style: { ...ICON_BUTTON, color: "var(--dsw-alias-label-dimmed)", cursor: "default" },
                disabled: true,
                "aria-label": "\u4E0A\u4E00\u9898\uFF08\u975E\u963B\u585E\u95EE\u9898\u9010\u6761\u5217\u51FA\uFF0C\u65E0\u9700\u7FFB\u9875\uFF09",
                children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconChevronLeftOutline14, {})
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { ...READOUT, padding: "0 4px", wordSpacing: -2 }, children: [
              index + 1,
              " / ",
              total
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                style: { ...ICON_BUTTON, color: "var(--dsw-alias-label-dimmed)", cursor: "default" },
                disabled: true,
                "aria-label": "\u4E0B\u4E00\u9898\uFF08\u975E\u963B\u585E\u95EE\u9898\u9010\u6761\u5217\u51FA\uFF0C\u65E0\u9700\u7FFB\u9875\uFF09",
                children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconChevronRightOutline14, {})
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { role: "status", style: {
            flex: 1,
            minHeight: 16,
            color: "var(--dsw-alias-state-error-primary)",
            fontSize: 11,
            lineHeight: "16px",
            textAlign: "right"
          }, children: error }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", disabled: locked, onClick: () => {
              questionStore.close(entry, "skipped");
            }, children: "\u8DF3\u8FC7\u672C\u9898" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "primary", disabled: !canSubmit || locked, onClick: () => {
              void submit();
            }, children: busy ? "\u53D1\u9001\u4E2D\u2026" : submitted ? "\u5DF2\u63D0\u4EA4" : "\u63D0\u4EA4" })
          ] })
        ] })
      ]
    }
  );
}
function QueuedQuestionToolRow({ block, callId, sessionId }) {
  const questions = (0, import_react.useMemo)(() => questionsFrom(block), [block]);
  const signature = JSON.stringify(questions);
  (0, import_react.useEffect)(() => {
    if (typeof sessionId !== "string" || typeof callId !== "string" || questions.length === 0) return;
    questionStore.enqueue(sessionId, callId, questions);
  }, [sessionId, callId, signature]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...PANEL, padding: 12, background: "var(--dsw-alias-bg-layer-1)" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { style: { fontSize: 13 }, children: "\u5DF2\u52A0\u5165\u975E\u963B\u585E\u95EE\u9898" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { margin: "6px 0 0", fontSize: 13, lineHeight: "20px", color: "var(--dsw-alias-label-secondary)" }, children: "Agent \u5DF2\u7EE7\u7EED\u5904\u7406\uFF0C\u4E0D\u4F1A\u7B49\u4F60\u7684\u56DE\u7B54\u3002\u95EE\u9898\u4F1A\u7559\u5728\u8F93\u5165\u6846\u4E0A\u65B9\uFF0C\u76F4\u5230\u4F60\u56DE\u7B54\u6216\u8DF3\u8FC7\u3002" })
  ] });
}
function QuestionDock({ sessionId, send }) {
  const target = typeof sessionId === "string" && sessionId !== "" ? sessionId : void 0;
  const entries = useQuestions(target);
  const [openKey, setOpenKey] = (0, import_react.useState)(void 0);
  const [collapsed, setCollapsed] = (0, import_react.useState)(false);
  const answer = send ?? (() => Promise.reject(new Error("\u539F\u5BF9\u8BDD\u5C1A\u672A\u52A0\u8F7D\uFF0C\u65E0\u6CD5\u53D1\u9001\u56DE\u7B54\u3002")));
  (0, import_react.useEffect)(() => {
    if (entries.length === 0) setOpenKey(void 0);
  }, [entries.length]);
  const newest = entries[entries.length - 1];
  const expandedKey = openKey ?? newest?.key;
  if (entries.length === 0) return null;
  const older = entries.filter((entry) => entry.key !== expandedKey);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: PANEL, "aria-label": "\u5F85\u7B54\u7684\u975E\u963B\u585E\u95EE\u9898", "data-dsh-proactive-questions": true, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        "aria-expanded": !collapsed,
        onClick: () => {
          setCollapsed((value) => !value);
        },
        style: {
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "6px 12px",
          border: "none",
          borderRadius: 12,
          background: "transparent",
          color: "inherit",
          textAlign: "left",
          cursor: "pointer"
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": true, style: { display: "grid", placeItems: "center", color: "var(--dsw-alias-label-tertiary)" }, children: "\u{1F4AC}" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { flex: "1 1 auto", minWidth: 0, fontSize: 13, fontWeight: 500, lineHeight: "20px" }, children: "Agent \u60F3\u542C\u542C\u4F60\u7684\u60F3\u6CD5" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { flex: "none", color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: entries.length > 1 ? `\u5171 ${entries.length} \u4E2A` : "" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": true, style: { flex: "none", color: "var(--dsw-alias-label-tertiary)", fontSize: 10 }, children: collapsed ? "\u25B2" : "\u25BC" })
        ]
      }
    ),
    collapsed ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: "0 12px 12px" }, children: [
      expandedKey !== void 0 ? (() => {
        const entry = entries.find((candidate) => candidate.key === expandedKey);
        if (entry === void 0) return null;
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          QuestionCard,
          {
            entry,
            send: answer,
            index: entries.findIndex((candidate) => candidate.key === entry.key),
            total: entries.length,
            onClose: () => {
              setOpenKey(entries.find((candidate) => candidate.key !== entry.key)?.key ?? entry.key);
            },
            expanded: questionVisibility(entry.askedAt) === "active" || openKey === entry.key
          },
          entry.key
        );
      })() : null,
      older.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 10, borderTop: "0.5px solid var(--dsw-alias-border-l1)", paddingTop: 10 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, color: "var(--dsw-alias-label-secondary)" }, children: entry.question.question }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            style: { flex: "none", border: "none", background: "transparent", color: "var(--dsw-alias-label-primary)", fontSize: 13, cursor: "pointer", padding: 0 },
            onClick: () => {
              setOpenKey(entry.key);
            },
            children: "\u56DE\u7B54"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            style: { flex: "none", border: "none", background: "transparent", color: "var(--dsw-alias-label-tertiary)", fontSize: 13, cursor: "pointer", padding: 0 },
            onClick: () => {
              questionStore.close(entry, "skipped");
            },
            children: "\u8DF3\u8FC7"
          }
        )
      ] }, entry.key)),
      entries.length > 1 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { marginTop: 10, display: "flex", justifyContent: "flex-end" }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          style: { border: "none", background: "transparent", color: "var(--dsw-alias-label-tertiary)", fontSize: 12, cursor: "pointer", padding: 0 },
          onClick: () => {
            if (target !== void 0) questionStore.skipAll(target);
          },
          children: "\u5168\u90E8\u8DF3\u8FC7"
        }
      ) }) : null
    ] })
  ] });
}

// src/client/host.ts
function asSessionId(value) {
  return typeof value === "string" && value !== "" ? value : void 0;
}
function scopedSend(ctx, sessionId) {
  if (sessionId === void 0) return void 0;
  return async (text) => {
    const scope = ctx.sessions?.scope?.(sessionId);
    if (scope === void 0) throw new Error("\u539F\u5BF9\u8BDD\u5C1A\u672A\u52A0\u8F7D\uFF0C\u65E0\u6CD5\u53D1\u9001\u56DE\u7B54\u3002");
    return await scope.conversation.send(text);
  };
}

// src/client/index.ts
var inject = ["slots", "sessions"];
function apply(ctx) {
  ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
    name: "tool.call.toolview",
    key: "queue_user_question",
    locale: "conversation"
  }, QueuedQuestionToolRow));
  ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
    name: "conversation.input.dock",
    id: "proactive-questioning-dock",
    order: 15,
    locale: "conversation",
    inject: (sessionId) => ({
      send: scopedSend(ctx, asSessionId(sessionId))
    })
  }, QuestionDock));
}

    return module.exports
  },
})
