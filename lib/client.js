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

// src/client/lifecycle.mjs
var ACTIVE_WINDOW_MS = 3e4;
function questionVisibility(askedAt, now = Date.now()) {
  return now - askedAt < ACTIVE_WINDOW_MS ? "active" : "bubble";
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
      this.scheduleVisibility(entry);
      changed = true;
    }
    if (changed) this.publish();
  }
  close(entry, state) {
    const current = this.entries.get(entry.key);
    if (current === void 0 || current.state !== "open") return;
    const next = { ...current, state };
    this.entries.set(entry.key, next);
    writeStored(next);
    this.clearTimer(entry.key);
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
    if (changed) this.publish();
  }
  scheduleVisibility(entry) {
    if (entry.state !== "open" || questionVisibility(entry.askedAt) === "bubble") return;
    const delay = Math.max(0, entry.askedAt + ACTIVE_WINDOW_MS - Date.now());
    this.timers.set(entry.key, setTimeout(() => {
      this.timers.delete(entry.key);
      this.publish();
    }, delay));
  }
  clearTimer(key) {
    const timer = this.timers.get(key);
    if (timer !== void 0) clearTimeout(timer);
    this.timers.delete(key);
  }
  publish() {
    this.snapshots.clear();
    for (const listener of this.listeners) listener();
  }
};
var questionStore = new QuestionStore();

// src/client/components.tsx
var panelStyle = {
  padding: 12,
  border: "1px solid var(--dsw-alias-border-l2)",
  borderRadius: 10,
  background: "var(--dsw-alias-bg-layer-1)",
  color: "var(--dsw-alias-label-primary)"
};
var buttonStyle = {
  border: "1px solid var(--dsw-alias-border-l2)",
  borderRadius: 7,
  padding: "6px 10px",
  background: "var(--dsw-alias-bg-base)",
  color: "inherit",
  cursor: "pointer"
};
function questionsFrom(block) {
  const raw = block?.call?.argsRaw;
  if (typeof raw !== "string") return [];
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
function useQuestions(sessionId) {
  return (0, import_react.useSyncExternalStore)(
    (listener) => questionStore.subscribe(listener),
    () => questionStore.snapshot(sessionId),
    () => []
  );
}
function answerText(entry, selected, custom) {
  return [
    `\u5BF9\u975E\u963B\u585E\u95EE\u9898\u300C${entry.question.question}\u300D\u7684\u56DE\u7B54\uFF1A`,
    JSON.stringify({ questionId: `${entry.callId}:${entry.question.id}`, selected, ...custom === "" ? {} : { custom } }),
    "\u8BF7\u628A\u5B83\u4F5C\u4E3A\u540E\u7EED\u5EFA\u8BAE\u6216\u51B3\u7B56\u7684\u8F93\u5165\uFF1B\u4E4B\u524D\u7684\u5DE5\u4F5C\u4E0D\u9700\u8981\u91CD\u505A\u3002"
  ].join("\n");
}
function QuestionCard({ entry, send }) {
  const [selected, setSelected] = (0, import_react.useState)([]);
  const [custom, setCustom] = (0, import_react.useState)("");
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)("");
  const canSubmit = selected.length > 0 || custom.trim() !== "";
  const choose = (label, checked) => {
    setSelected((previous) => entry.question.multiSelect ? checked ? [...previous, label] : previous.filter((value) => value !== label) : checked ? [label] : []);
  };
  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError("");
    try {
      await send(answerText(entry, selected, custom.trim()));
      questionStore.close(entry, "answered");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "\u56DE\u7B54\u672A\u80FD\u53D1\u9001\u5230\u6B64\u5BF9\u8BDD\u3002");
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ React.createElement("section", { style: { ...panelStyle, marginTop: 8 }, "aria-label": "\u975E\u963B\u585E\u95EE\u9898" }, entry.question.header ? /* @__PURE__ */ React.createElement("div", { style: { opacity: 0.72, fontSize: 12 } }, entry.question.header) : null, /* @__PURE__ */ React.createElement("div", { style: { marginTop: 4, whiteSpace: "pre-wrap" } }, entry.question.question), (entry.question.options ?? []).map((option) => /* @__PURE__ */ React.createElement("label", { key: option.label, style: { display: "flex", gap: 7, marginTop: 8, alignItems: "flex-start" } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: entry.question.multiSelect ? "checkbox" : "radio",
      name: entry.key,
      checked: selected.includes(option.label),
      disabled: busy,
      onChange: (event) => choose(option.label, event.currentTarget.checked)
    }
  ), /* @__PURE__ */ React.createElement("span", null, option.label, option.description ? /* @__PURE__ */ React.createElement("small", { style: { display: "block", opacity: 0.72 } }, option.description) : null))), /* @__PURE__ */ React.createElement(
    "textarea",
    {
      "aria-label": "\u8865\u5145\u56DE\u7B54",
      value: custom,
      disabled: busy,
      onChange: (event) => setCustom(event.currentTarget.value),
      placeholder: "\u4E5F\u53EF\u4EE5\u4E0D\u9009\u9009\u9879\uFF0C\u76F4\u63A5\u5199\u60F3\u6CD5",
      style: { boxSizing: "border-box", width: "100%", minHeight: 56, marginTop: 8, padding: 7, color: "inherit", background: "var(--dsw-alias-bg-base)", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 6 }
    }
  ), error ? /* @__PURE__ */ React.createElement("p", { role: "alert", style: { margin: "8px 0 0" } }, error) : null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, marginTop: 8 } }, /* @__PURE__ */ React.createElement("button", { style: buttonStyle, disabled: !canSubmit || busy, onClick: () => {
    void submit();
  } }, busy ? "\u53D1\u9001\u4E2D\u2026" : "\u63D0\u4EA4\u56DE\u7B54"), /* @__PURE__ */ React.createElement("button", { style: buttonStyle, disabled: busy, onClick: () => questionStore.close(entry, "skipped") }, "\u8DF3\u8FC7")));
}
function QueuedQuestionToolRow({ block, callId, sessionId }) {
  const questions = questionsFrom(block);
  (0, import_react.useEffect)(() => {
    if (typeof sessionId !== "string" || typeof callId !== "string" || questions.length === 0) return;
    questionStore.enqueue(sessionId, callId, questions);
  }, [sessionId, callId, JSON.stringify(questions)]);
  return /* @__PURE__ */ React.createElement("div", { style: panelStyle }, /* @__PURE__ */ React.createElement("strong", null, "\u5DF2\u52A0\u5165\u975E\u963B\u585E\u95EE\u9898"), /* @__PURE__ */ React.createElement("p", { style: { margin: "6px 0 0" } }, "Agent \u5DF2\u7EE7\u7EED\u5904\u7406\uFF1B\u95EE\u9898\u4F1A\u5148\u663E\u793A 30 \u79D2\uFF0C\u4E4B\u540E\u8FDB\u5165\u8F93\u5165\u6846\u65C1\u7684\u6C14\u6CE1\u3002\u56DE\u7B54\u3001\u8DF3\u8FC7\u6216\u5173\u95ED\u90FD\u4E0D\u4F1A\u56DE\u5199\u8FD9\u6B21\u5DE5\u5177\u8C03\u7528\u3002"));
}
function QuestionDock({ sessionId, send }) {
  const entries = useQuestions(sessionId);
  const active = entries.filter((entry) => questionVisibility(entry.askedAt) === "active");
  if (active.length === 0) return null;
  return /* @__PURE__ */ React.createElement("section", { style: { ...panelStyle, margin: "0 auto 10px", maxWidth: 760 }, "aria-label": "\u521A\u63D0\u51FA\u7684\u975E\u963B\u585E\u95EE\u9898" }, /* @__PURE__ */ React.createElement("strong", null, "Agent \u60F3\u542C\u542C\u4F60\u7684\u60F3\u6CD5"), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: 8, opacity: 0.72, fontSize: 12 } }, "\u5B83\u4E0D\u4F1A\u7B49\u4F60\u7684\u56DE\u7B54\uFF0C30 \u79D2\u540E\u4F1A\u6536\u8FDB\u6C14\u6CE1"), active.map((entry) => /* @__PURE__ */ React.createElement(QuestionCard, { key: entry.key, entry, send })));
}
function QuestionBubble({ sessionId, send }) {
  const entries = useQuestions(sessionId);
  const pending = entries.filter((entry) => questionVisibility(entry.askedAt) === "bubble");
  const [open, setOpen] = (0, import_react.useState)(false);
  (0, import_react.useEffect)(() => {
    if (pending.length === 0) setOpen(false);
  }, [pending.length]);
  if (pending.length === 0) return null;
  return /* @__PURE__ */ React.createElement("div", { style: { position: "relative" } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      style: { ...buttonStyle, borderRadius: 999, padding: "5px 9px" },
      "aria-label": `\u6253\u5F00 ${pending.length} \u4E2A\u5F85\u7B54\u95EE\u9898`,
      onClick: () => setOpen((value) => !value)
    },
    "\u{1F4AC} ",
    pending.length
  ), open ? /* @__PURE__ */ React.createElement("section", { style: { ...panelStyle, position: "absolute", zIndex: 12, width: 340, maxHeight: 440, overflowY: "auto", left: 0, bottom: "calc(100% + 8px)" }, "aria-label": "\u5F85\u7B54\u95EE\u9898\u5217\u8868" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: 8 } }, /* @__PURE__ */ React.createElement("strong", null, "\u5F85\u7B54\u95EE\u9898"), /* @__PURE__ */ React.createElement("button", { style: buttonStyle, onClick: () => questionStore.skipAll(sessionId) }, "\u5168\u90E8\u8DF3\u8FC7")), pending.map((entry) => /* @__PURE__ */ React.createElement(QuestionCard, { key: entry.key, entry, send }))) : null);
}

// src/client/index.ts
var inject = ["slots", "sessions"];
function apply(ctx) {
  const send = (sessionId) => async (text) => {
    const scope = ctx.sessions.scope(sessionId);
    if (scope === void 0) throw new Error("\u539F\u5BF9\u8BDD\u5C1A\u672A\u52A0\u8F7D\uFF0C\u65E0\u6CD5\u53D1\u9001\u56DE\u7B54\u3002");
    return await scope.conversation.send(text);
  };
  ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
    name: "tool.call.toolview",
    key: "queue_user_question",
    locale: "conversation"
  }, QueuedQuestionToolRow));
  ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
    name: "conversation.input.dock",
    id: "proactive-questioning-dock",
    order: 15,
    inject: (sessionId) => ({ sessionId, send: send(sessionId) })
  }, QuestionDock));
  ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
    name: "conversation.input.left",
    id: "proactive-questioning-bubble",
    order: 5,
    inject: (sessionId) => ({ sessionId, send: send(sessionId) })
  }, QuestionBubble));
}

    return module.exports
  },
})
