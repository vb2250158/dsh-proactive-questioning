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
var ACTIVE_WINDOW_MS = 12e4;
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
    if (changed) this.publish();
  }
  close(entry, state) {
    const current = this.entries.get(entry.key);
    if (current === void 0 || current.state !== "open") return;
    const next = { ...current, state };
    this.entries.set(entry.key, next);
    writeStored(next);
    this.clearTimer(entry.key);
    this.prune(entry.sessionId);
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
  /** Drop every pending accent timer. Used by tests and page teardown. */
  dispose() {
    for (const key of [...this.timers.keys()]) this.clearTimer(key);
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
function Chip({ label, selected, disabled, onClick }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "button",
    {
      type: "button",
      role: "radio",
      "aria-checked": selected,
      disabled,
      onClick,
      style: {
        border: `1px solid ${selected ? "var(--dsw-alias-state-business-primary)" : "var(--dsw-alias-border-l2)"}`,
        borderRadius: 999,
        padding: "5px 11px",
        fontSize: 13,
        lineHeight: "18px",
        background: selected ? "var(--dsw-alias-interactive-bg-hover)" : "var(--dsw-alias-bg-base)",
        color: "var(--dsw-alias-label-primary)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1
      },
      children: label
    }
  );
}
function Action({ label, primary, disabled, onClick }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "button",
    {
      type: "button",
      disabled,
      onClick,
      style: {
        border: primary ? "1px solid transparent" : "0.5px solid var(--dsw-alias-border-l3)",
        borderRadius: 999,
        padding: "5px 12px",
        fontSize: 12,
        lineHeight: "18px",
        background: primary ? "var(--dsw-alias-button-primary-fill)" : "transparent",
        color: primary ? "var(--dsw-alias-label-primary-foreground)" : "var(--dsw-alias-label-secondary)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1
      },
      children: label
    }
  );
}
function QuestionCard({ entry, send, expanded }) {
  const [selected, setSelected] = (0, import_react.useState)([]);
  const [custom, setCustom] = (0, import_react.useState)("");
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)("");
  const [submitted, setSubmitted] = (0, import_react.useState)(false);
  const options = entry.question.options ?? [];
  const canSubmit = selected.length > 0 || custom.trim() !== "";
  const choose = (label) => {
    setSelected((previous) => entry.question.multiSelect ? previous.includes(label) ? previous.filter((value) => value !== label) : [...previous, label] : previous.includes(label) ? [] : [label]);
  };
  const submit = async () => {
    if (!canSubmit || busy || submitted) return;
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
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "div",
    {
      role: "group",
      "aria-label": entry.question.question,
      style: { marginTop: 10, ...expanded ? {} : { borderTop: "0.5px solid var(--dsw-alias-border-l1)", paddingTop: 10 } },
      children: [
        expanded && entry.question.header ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, marginBottom: 4 }, children: entry.question.header }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 13, lineHeight: "20px", whiteSpace: "pre-wrap" }, children: entry.question.question }),
        options.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "div",
          {
            role: entry.question.multiSelect ? "group" : "radiogroup",
            "aria-label": entry.question.multiSelect ? "\u53EF\u591A\u9009" : "\u5355\u9009",
            style: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 },
            children: options.map((option) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              Chip,
              {
                label: option.label,
                disabled: busy,
                selected: selected.includes(option.label),
                onClick: () => {
                  choose(option.label);
                }
              },
              option.label
            ))
          }
        ),
        expanded ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "textarea",
          {
            "aria-label": "\u8865\u5145\u56DE\u7B54",
            value: custom,
            disabled: busy,
            onChange: (event) => setCustom(event.currentTarget.value),
            placeholder: "\u4E5F\u53EF\u4EE5\u4E0D\u9009\u9009\u9879\uFF0C\u76F4\u63A5\u5199\u60F3\u6CD5",
            style: {
              boxSizing: "border-box",
              width: "100%",
              minHeight: 56,
              marginTop: 8,
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
        ) : null,
        error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", style: { margin: "8px 0 0", fontSize: 13, color: "var(--dsw-alias-state-error-primary)" }, children: error }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 10 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Action, { label: busy ? "\u53D1\u9001\u4E2D\u2026" : submitted ? "\u5DF2\u63D0\u4EA4" : "\u63D0\u4EA4\u56DE\u7B54", primary: true, disabled: !canSubmit || busy || submitted, onClick: () => {
            void submit();
          } }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Action, { label: "\u8DF3\u8FC7", primary: false, disabled: busy || submitted, onClick: () => {
            questionStore.close(entry, "skipped");
          } }),
          !custom.trim() && options.length > 0 && !expanded ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: "\u4E5F\u53EF\u4EE5\u76F4\u63A5\u5199\u4E0B\u60F3\u6CD5" }) : null
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
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { flex: "none", color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: [
            entries.length > 1 ? `\u5171 ${entries.length} \u4E2A \xB7 ` : "",
            "\u5B83\u4E0D\u4F1A\u7B49\u4F60"
          ] }),
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
