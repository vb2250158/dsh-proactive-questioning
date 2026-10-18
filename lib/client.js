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
var import_react2 = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/lifecycle.mjs
var ACTIVE_WINDOW_MS = 12e4;
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

// src/client/content.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var QuestionContentContext = (0, import_react.createContext)(void 0);
function QuestionContent({ text }) {
  const render = (0, import_react.useContext)(QuestionContentContext);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: render === void 0 ? text : render("proactive.question.content", { text }, { fallback: text }) });
}

// dsh-css: dsh-css:G:\DigitalLife\DSHPlugins\packages\dsh-proactive-questioning\src\client\question-card.module.css.mjs
var css = '.v_Nm0q_card{--dsw-elevation-stroke-color:var(--dsw-alias-border-l2-darkmode-thin);background:var(--dsw-specific-input-major);width:100%;max-height:min(52vh,480px);box-shadow:none;color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border:0;border-radius:0;flex-direction:column;padding:0;display:flex;overflow:hidden}.v_Nm0q_card,.v_Nm0q_card *{box-sizing:border-box}.v_Nm0q_headerActions{flex-shrink:0;align-items:center;gap:4px;display:flex}.v_Nm0q_header{flex-shrink:0;justify-content:space-between;align-items:flex-start;gap:16px;padding:0 24px 10px;display:flex}.v_Nm0q_headingBlock{min-width:0}.v_Nm0q_eyebrow{color:var(--dsw-alias-label-tertiary);margin-bottom:5px;font-size:11px;line-height:16px}.v_Nm0q_title{margin:0;font-size:16px;font-weight:500;line-height:23px}.v_Nm0q_footerActions{flex-shrink:0;align-items:center;gap:12px;margin-left:auto;display:flex}.v_Nm0q_pager{flex-shrink:0;align-items:center;gap:6px;display:flex}.v_Nm0q_progress{color:var(--dsw-alias-label-secondary);white-space:nowrap;word-spacing:-2px;padding:0 4px;font-size:14px;font-weight:500;line-height:24px}.v_Nm0q_iconButton{corner-shape:round;width:32px;height:32px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:999px;place-items:center;padding:0;display:grid}.v_Nm0q_iconButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.v_Nm0q_iconButton:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}.v_Nm0q_body{overscroll-behavior:contain;flex-direction:column;flex:auto;min-height:0;display:flex;overflow-y:auto}.v_Nm0q_options{flex-direction:column;gap:2px;margin:0;padding:0 24px 10px;display:flex}.v_Nm0q_option{width:100%;min-height:40px;color:inherit;text-align:left;cursor:pointer;background:0 0;border:1px solid #0000;border-radius:10px;flex-wrap:wrap;flex-shrink:0;align-items:flex-start;gap:8px;padding:8px 0;transition:background-color .12s,border-color .12s;display:flex}.v_Nm0q_option:hover:not(:disabled),.v_Nm0q_optionSelected{background:var(--dsw-alias-interactive-bg-hover)}.v_Nm0q_optionSelected,.v_Nm0q_option[aria-checked=true]{background:var(--dsw-specific-sidebar-nav-item-active-accent);border-color:#0000}.v_Nm0q_optionSelected .v_Nm0q_number{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-foreground)}.v_Nm0q_optionChoice:focus-visible,.v_Nm0q_iconButton:focus-visible,.v_Nm0q_dockBar:focus-visible,.v_Nm0q_linkButton:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.v_Nm0q_option:disabled{cursor:default}.v_Nm0q_optionChoice{min-width:0;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;flex:0 auto;align-items:flex-start;gap:8px;padding:0;display:flex}.v_Nm0q_optionChoice:disabled{cursor:default}.v_Nm0q_option>.v_Nm0q_description{flex:180px;min-width:0}.v_Nm0q_detail{min-width:0;padding:0 24px 12px}.v_Nm0q_number{background:var(--dsw-alias-bg-overlay);width:20px;height:20px;color:var(--dsw-alias-label-secondary);border-radius:6px;flex:0 0 20px;place-items:center;margin-top:2px;font-size:12px;font-weight:500;line-height:18px;display:grid}.v_Nm0q_checkbox{flex:0 0 20px;place-items:center;width:20px;height:20px;margin-top:0;display:grid}.v_Nm0q_checkbox:before{content:"";border:.5px solid var(--dsw-alias-border-l4);border-radius:4px;grid-area:1/1;width:14px;height:14px;transition:background-color .12s,border-color .12s}.v_Nm0q_checkbox>svg{grid-area:1/1}.v_Nm0q_checkboxChecked{color:var(--dsw-alias-label-primary-foreground)}.v_Nm0q_checkboxChecked:before{border-color:var(--dsw-alias-label-primary);background:var(--dsw-alias-label-primary)}.v_Nm0q_optionCopy{flex:1;min-width:0}.v_Nm0q_optionLine{flex-wrap:wrap;align-items:baseline;gap:0 6px;display:flex}.v_Nm0q_optionLabel{font-size:14px;font-weight:500;line-height:20px}.v_Nm0q_badge{background:var(--dsw-specific-sidebar-nav-item-active-accent);color:var(--dsw-alias-button-info-fill);border-radius:6px;padding:0 4px;font-size:11px;font-weight:600;line-height:18px}.v_Nm0q_description{color:var(--dsw-alias-label-secondary);flex-basis:auto;font-size:14px;font-weight:400;line-height:20px}.v_Nm0q_customRow{background:0 0;border:1px solid #0000;border-radius:10px;flex-shrink:0;align-items:flex-start;gap:8px;width:100%;min-height:40px;margin-top:2px;padding:8px 0;transition:background-color .12s,border-color .12s;display:flex}.v_Nm0q_customRow:hover,.v_Nm0q_customRow:focus-within,.v_Nm0q_customRowActive{background:var(--dsw-alias-interactive-bg-hover)}.v_Nm0q_customRow:focus-within,.v_Nm0q_customRowActive{border-color:var(--dsw-alias-border-l2)}.v_Nm0q_field{--dsh-answer-field-padding:0;min-width:0;display:grid}.v_Nm0q_field>*{min-width:0;padding:var(--dsh-answer-field-padding);font:inherit;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;grid-area:1/1;font-size:14px;line-height:24px}.v_Nm0q_fieldMirror{box-sizing:content-box;visibility:hidden;max-height:144px;overflow:hidden}.v_Nm0q_fieldInput{resize:none;color:var(--dsw-alias-label-primary);caret-color:var(--dsw-alias-state-business-primary);background:0 0;border:none;outline:none;overflow-y:auto}.v_Nm0q_fieldInput::placeholder{color:var(--dsw-alias-label-caption)}.v_Nm0q_customInline{flex:1}.v_Nm0q_customBlock{--dsh-answer-field-padding:8px 12px;background:0 0;border:1px solid #0000;border-radius:10px;flex-shrink:0;min-height:64px;margin:0}.v_Nm0q_customBlock:focus-within{border-color:var(--dsw-alias-state-business-primary)}.v_Nm0q_footer{border-top:none;flex-wrap:wrap;flex-shrink:0;justify-content:space-between;align-items:center;gap:12px;margin-top:0;padding:8px 24px;display:flex}.v_Nm0q_feedback:empty{display:none}.v_Nm0q_feedback{min-height:16px;color:var(--dsw-alias-state-error-primary);text-align:right;flex:1;font-size:11px;line-height:16px}.v_Nm0q_countdown{color:var(--dsw-alias-label-tertiary);white-space:nowrap;font-variant-numeric:tabular-nums;padding:0 4px;font-size:14px;font-weight:500;line-height:24px}.v_Nm0q_countdown[data-state=settled]{color:var(--dsw-alias-label-caption)}.v_Nm0q_dock{box-sizing:border-box;width:calc(100% - 32px);max-width:var(--dsh-chat-content-width,920px);box-shadow:none;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary);border:none;border-radius:20px;margin:4px auto 8px;overflow:hidden}.v_Nm0q_dockBar{width:100%;color:inherit;text-align:left;cursor:pointer;background:0 0;border:none;border-radius:12px;align-items:center;gap:10px;padding:10px 24px 6px;display:flex}.v_Nm0q_dockTitle{flex:auto;min-width:0;font-size:13px;font-weight:500;line-height:20px}.v_Nm0q_dockCount{color:var(--dsw-alias-label-tertiary);flex:none;font-size:12px}.v_Nm0q_dockCaret{color:var(--dsw-alias-label-tertiary);flex:none;font-size:10px}.v_Nm0q_dockBody{padding:0}.v_Nm0q_olderRow{margin-inline:24px;border-top:.5px solid var(--dsw-alias-border-l1);align-items:center;gap:8px;margin-top:10px;padding-top:10px;padding-bottom:10px;display:flex}.v_Nm0q_olderLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-secondary);flex:auto;font-size:13px;overflow:hidden}.v_Nm0q_linkButton{color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;flex:none;padding:0;font-size:13px}.v_Nm0q_linkButtonMuted{color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;flex:none;padding:0;font-size:13px}.v_Nm0q_skipAllRow{justify-content:flex-end;margin-top:10px;padding:0 24px 20px;display:flex}.v_Nm0q_skipAll{color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px}.v_Nm0q_toolRow{border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:12px;padding:12px}.v_Nm0q_toolRowTitle{font-size:13px}@media (width<=720px){.v_Nm0q_dockBar{padding:10px 16px 6px}.v_Nm0q_header,.v_Nm0q_options{padding:0 16px 10px}.v_Nm0q_title{font-size:15px;line-height:21px}.v_Nm0q_footer{padding:8px 16px}}@media (prefers-reduced-motion:reduce){.v_Nm0q_option,.v_Nm0q_customRow{transition:none}}.v_Nm0q_pager[hidden]{display:none}.v_Nm0q_field:has(>[data-rabi-question-mic]){grid-template-columns:minmax(0,1fr) auto 28px;align-items:center;column-gap:8px}.v_Nm0q_field>[data-rabi-question-auto]{grid-template-columns:36px auto;white-space:nowrap!important;grid-area:1/2!important;gap:4px 6px!important;padding:0!important;display:grid!important}.v_Nm0q_field>[data-rabi-question-auto]>[role=status]{white-space:normal;grid-column:1/-1;max-width:180px}.v_Nm0q_field>[data-rabi-question-auto]>[role=status]:empty{display:none}.v_Nm0q_field>[data-rabi-question-mic]{grid-area:1/3!important;right:0!important}.v_Nm0q_field>.v_Nm0q_fieldInput[data-rabi-question-enhanced]{padding-right:0!important}@media (width<=520px){.v_Nm0q_field:has(>[data-rabi-question-mic])>.v_Nm0q_fieldInput,.v_Nm0q_field:has(>[data-rabi-question-mic])>.v_Nm0q_fieldMirror{grid-area:1/1/2/4}.v_Nm0q_field>[data-rabi-question-auto]{grid-area:2/2!important}.v_Nm0q_field>[data-rabi-question-mic]{grid-area:2/3!important}}';
var tagId = "dsh-proactive-questioning/question-card.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-proactive-questioning";
  tag.dataset.pluginCss = tagId;
  tag.textContent = css;
  document.head.appendChild(tag);
}
var question_card_module_css_default = { "customBlock": "v_Nm0q_customBlock", "detail": "v_Nm0q_detail", "badge": "v_Nm0q_badge", "footer": "v_Nm0q_footer", "dockCount": "v_Nm0q_dockCount", "dockBody": "v_Nm0q_dockBody", "card": "v_Nm0q_card", "olderRow": "v_Nm0q_olderRow", "iconButton": "v_Nm0q_iconButton", "linkButtonMuted": "v_Nm0q_linkButtonMuted", "toolRowTitle": "v_Nm0q_toolRowTitle", "feedback": "v_Nm0q_feedback", "olderLabel": "v_Nm0q_olderLabel", "skipAll": "v_Nm0q_skipAll", "dock": "v_Nm0q_dock", "body": "v_Nm0q_body", "dockTitle": "v_Nm0q_dockTitle", "fieldMirror": "v_Nm0q_fieldMirror", "skipAllRow": "v_Nm0q_skipAllRow", "description": "v_Nm0q_description", "header": "v_Nm0q_header", "dockCaret": "v_Nm0q_dockCaret", "number": "v_Nm0q_number", "customRow": "v_Nm0q_customRow", "optionLine": "v_Nm0q_optionLine", "field": "v_Nm0q_field", "pager": "v_Nm0q_pager", "countdown": "v_Nm0q_countdown", "toolRow": "v_Nm0q_toolRow", "linkButton": "v_Nm0q_linkButton", "eyebrow": "v_Nm0q_eyebrow", "fieldInput": "v_Nm0q_fieldInput", "footerActions": "v_Nm0q_footerActions", "optionSelected": "v_Nm0q_optionSelected", "optionLabel": "v_Nm0q_optionLabel", "optionChoice": "v_Nm0q_optionChoice", "optionCopy": "v_Nm0q_optionCopy", "customInline": "v_Nm0q_customInline", "option": "v_Nm0q_option", "headerActions": "v_Nm0q_headerActions", "title": "v_Nm0q_title", "checkbox": "v_Nm0q_checkbox", "checkboxChecked": "v_Nm0q_checkboxChecked", "options": "v_Nm0q_options", "headingBlock": "v_Nm0q_headingBlock", "progress": "v_Nm0q_progress", "customRowActive": "v_Nm0q_customRowActive", "dockBar": "v_Nm0q_dockBar" };

// src/client/answer-message.mjs
function answerText(entry, selected, custom) {
  return [
    `\u5BF9\u975E\u963B\u585E\u95EE\u9898\u300C${entry.question.question}\u300D\u7684\u56DE\u7B54\uFF1A`,
    JSON.stringify({ questionId: `${entry.callId}:${entry.question.id}`, selected, ...custom === "" ? {} : { custom } }),
    "\u8BF7\u628A\u5B83\u4F5C\u4E3A\u540E\u7EED\u5EFA\u8BAE\u6216\u51B3\u7B56\u7684\u8F93\u5165\uFF1B\u4E4B\u524D\u7684\u5DE5\u4F5C\u4E0D\u9700\u8981\u91CD\u505A\u3002"
  ].join("\n");
}
function parseAnswerText(text) {
  const suffix = "\n\u8BF7\u628A\u5B83\u4F5C\u4E3A\u540E\u7EED\u5EFA\u8BAE\u6216\u51B3\u7B56\u7684\u8F93\u5165\uFF1B\u4E4B\u524D\u7684\u5DE5\u4F5C\u4E0D\u9700\u8981\u91CD\u505A\u3002";
  const prefix = "\u5BF9\u975E\u963B\u585E\u95EE\u9898\u300C";
  const separator = "\u300D\u7684\u56DE\u7B54\uFF1A\n";
  if (!text.startsWith(prefix) || !text.endsWith(suffix)) return void 0;
  const split = text.lastIndexOf(separator, text.length - suffix.length);
  if (split < prefix.length) return void 0;
  const question = text.slice(prefix.length, split);
  if (question.trim() === "") return void 0;
  try {
    const value = JSON.parse(text.slice(split + separator.length, -suffix.length));
    if (value === null || typeof value !== "object" || Array.isArray(value) || typeof value.questionId !== "string" || value.questionId.trim() === "" || !Array.isArray(value.selected) || !value.selected.every((item) => typeof item === "string") || value.custom !== void 0 && typeof value.custom !== "string" || Object.keys(value).some((key) => !["questionId", "selected", "custom"].includes(key)) || value.selected.length === 0 && (value.custom ?? "").trim() === "") return void 0;
    return { question, selected: value.selected, custom: value.custom ?? "" };
  } catch (error) {
    return void 0;
  }
}

// src/client/components.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var COPY = {
  unanswered: "\u8BF7\u9009\u62E9\u4E00\u4E2A\u9009\u9879\u6216\u586B\u5199\u81EA\u5B9A\u4E49\u7B54\u6848\u3002",
  prev: "\u4E0A\u4E00\u9898",
  next: "\u4E0B\u4E00\u9898",
  close: "\u6536\u8D77\u8349\u7A3F\uFF08\u95EE\u9898\u4ECD\u4FDD\u7559\uFF0C\u53EF\u968F\u65F6\u56DE\u6765\u56DE\u7B54\uFF09",
  recommended: "\u63A8\u8350",
  customPlaceholder: "\u8F93\u5165\u4F60\u7684\u7B54\u6848",
  skip: "\u8DF3\u8FC7\u672C\u9898"
};
function parseRecommendedLabel(label) {
  const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i;
  return suffix.test(label) ? { label: label.replace(suffix, ""), recommended: true } : { label, recommended: false };
}
function isComposing(event) {
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
}
function AnswerField(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: `${question_card_module_css_default.field} ${props.variant === "inline" ? question_card_module_css_default.customInline : question_card_module_css_default.customBlock}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { "aria-hidden": true, className: question_card_module_css_default.fieldMirror, children: `${props.value}
` }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "textarea",
      {
        autoFocus: props.autoFocus,
        className: question_card_module_css_default.fieldInput,
        value: props.value,
        disabled: props.disabled,
        rows: 1,
        placeholder: props.placeholder,
        "aria-label": props.placeholder,
        onFocus: props.onFocus,
        onChange: props.onChange,
        onKeyDown: props.onKeyDown
      }
    )
  ] });
}
function Countdown({ askedAt }) {
  const remaining = questionRemainingSeconds(askedAt);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
    "span",
    {
      className: question_card_module_css_default.countdown,
      "data-dsh-question-countdown": true,
      "data-state": remaining === void 0 ? "settled" : "counting",
      title: "\u65B0\u9C9C\u671F\u5269\u4F59\u65F6\u95F4\u3002\u5230\u671F\u540E\u95EE\u9898\u4ECD\u7136\u4FDD\u7559\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u5173\u95ED\u3002",
      "aria-label": remaining === void 0 ? "\u65B0\u9C9C\u671F\u5DF2\u8FC7\uFF0C\u95EE\u9898\u4ECD\u7136\u4FDD\u7559" : `\u65B0\u9C9C\u671F\u8FD8\u5269 ${String(remaining)} \u79D2`,
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
      if (record.options !== void 0 && (!Array.isArray(record.options) || options?.length !== record.options.length)) return [];
      questions.push({
        id: record.id,
        question: record.question,
        ...typeof record.detail === "string" ? { detail: record.detail } : {},
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
  const revision = (0, import_react2.useSyncExternalStore)(
    (listener) => questionStore.subscribe(listener),
    () => questionStore.revision,
    () => 0
  );
  return (0, import_react2.useMemo)(
    () => sessionId === void 0 ? [] : questionStore.snapshot(sessionId),
    // `revision` is the store's mutation counter: it republishes every snapshot,
    // so it is the only correctness input besides the identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revision, sessionId]
  );
}
function OptionRow({ index, option, selected, multiSelect, busy, onChoose }) {
  const display = parseRecommendedLabel(option.label);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: `${question_card_module_css_default.option} ${selected ? question_card_module_css_default.optionSelected : ""}`, onClick: (event) => {
    if (busy || event.target.closest('button, a, img, input, textarea, [role="button"]') !== null) return;
    onChoose();
  }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
      "button",
      {
        type: "button",
        className: question_card_module_css_default.optionChoice,
        "data-dsh-question-option": true,
        "data-selected": selected ? "true" : "false",
        role: multiSelect ? "checkbox" : "radio",
        "aria-checked": selected,
        "aria-label": display.label,
        disabled: busy,
        onClick: onChoose,
        children: [
          multiSelect ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: `${question_card_module_css_default.checkbox} ${selected ? question_card_module_css_default.checkboxChecked : ""}`, "aria-hidden": "true", children: selected && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.IconCheckOutlineRegular, { size: 12 }) }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: question_card_module_css_default.number, "aria-hidden": "true", children: selected ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.IconCheckOutlineRegular, { size: 12 }) : index + 1 }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: question_card_module_css_default.optionCopy, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: question_card_module_css_default.optionLine, children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: question_card_module_css_default.optionLabel, children: display.label }),
            display.recommended && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: question_card_module_css_default.badge, children: COPY.recommended })
          ] }) })
        ]
      }
    ),
    option.description !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: question_card_module_css_default.description, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(QuestionContent, { text: option.description }) })
  ] });
}
function QuestionCard({ entry, send, index, total, onClose, onNavigate, drafts, t }) {
  const question = entry.question;
  const [selected, setSelected] = (0, import_react2.useState)(() => drafts.get(entry.key)?.selected ?? []);
  const [custom, setCustom] = (0, import_react2.useState)(() => drafts.get(entry.key)?.custom ?? "");
  (0, import_react2.useEffect)(() => {
    drafts.set(entry.key, { selected, custom });
  }, [drafts, entry.key, selected, custom]);
  const [busy, setBusy] = (0, import_react2.useState)(false);
  const [error, setError] = (0, import_react2.useState)("");
  const [submitted, setSubmitted] = (0, import_react2.useState)(false);
  const sending = (0, import_react2.useRef)(false);
  const focused = (0, import_react2.useRef)(false);
  const options = question.options ?? [];
  const multiSelect = question.multiSelect === true;
  const hasOptions = options.length > 0;
  const answered = selected.length > 0 || custom.trim() !== "";
  const locked = busy || submitted;
  const last = index === total - 1;
  const choose = (label) => {
    if (!multiSelect) {
      setCustom("");
      setSelected([label]);
      void submit([label], "");
      return;
    }
    setSelected((current) => multiSelect ? current.includes(label) ? current.filter((item) => item !== label) : [...current, label] : current.includes(label) ? [] : [label]);
  };
  const draftCustom = (event) => {
    const value = event.currentTarget.value;
    setSelected((current) => multiSelect ? current : []);
    setCustom(value);
  };
  const submit = async (labels = selected, text = custom.trim()) => {
    if (labels.length === 0 && text === "") {
      setError(COPY.unanswered);
      return;
    }
    if (locked || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      await send(answerText(entry, labels, text));
      setSubmitted(true);
      questionStore.close(entry, "answered");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "\u56DE\u7B54\u672A\u80FD\u53D1\u9001\u5230\u6B64\u5BF9\u8BDD\u3002");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const continueFromCustom = (event) => {
    if (event.key !== "Enter" || event.shiftKey || isComposing(event)) return;
    event.preventDefault();
    void submit();
  };
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "section",
    {
      className: question_card_module_css_default.card,
      "data-dsh-question-card": true,
      "aria-labelledby": `dsh-question-${entry.key}`,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("header", { className: question_card_module_css_default.header, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: question_card_module_css_default.headingBlock, children: [
            question.header !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: question_card_module_css_default.eyebrow, children: question.header }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: question_card_module_css_default.title, role: "heading", "aria-level": 2, id: `dsh-question-${entry.key}`, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(QuestionContent, { text: question.question }) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: question_card_module_css_default.headerActions, children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Countdown, { askedAt: entry.askedAt }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "button",
              {
                type: "button",
                className: question_card_module_css_default.iconButton,
                "aria-label": COPY.close,
                title: COPY.close,
                disabled: locked,
                onClick: onClose,
                children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.IconCloseOutlineRegular, {})
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: question_card_module_css_default.body, children: [
          question.detail !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: question_card_module_css_default.detail, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(QuestionContent, { text: question.detail }) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: question_card_module_css_default.options, role: multiSelect ? "group" : "radiogroup", children: [
            options.map((option, optionIndex) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              OptionRow,
              {
                index: optionIndex,
                option,
                selected: selected.includes(option.label),
                multiSelect,
                busy: locked,
                onChoose: () => {
                  choose(option.label);
                }
              },
              `${option.label}-${String(optionIndex)}`
            )),
            hasOptions ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: `${question_card_module_css_default.customRow} ${custom !== "" ? question_card_module_css_default.customRowActive : ""}`, children: [
              multiSelect ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: `${question_card_module_css_default.checkbox} ${custom !== "" ? question_card_module_css_default.checkboxChecked : ""}`, "aria-hidden": "true", children: custom !== "" && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.IconCheckOutlineRegular, { size: 12 }) }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: question_card_module_css_default.number, "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.IconEditOutlineRegular, { size: 12 }) }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                AnswerField,
                {
                  variant: "inline",
                  value: custom,
                  disabled: locked,
                  placeholder: COPY.customPlaceholder,
                  onChange: draftCustom,
                  onKeyDown: continueFromCustom
                }
              )
            ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              AnswerField,
              {
                autoFocus: !focused.current,
                variant: "block",
                value: custom,
                disabled: locked,
                placeholder: COPY.customPlaceholder,
                onFocus: () => {
                  focused.current = true;
                },
                onChange: draftCustom,
                onKeyDown: continueFromCustom
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("footer", { className: question_card_module_css_default.footer, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: question_card_module_css_default.pager, hidden: total === 1, children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "button",
              {
                type: "button",
                className: question_card_module_css_default.iconButton,
                "aria-label": COPY.prev,
                disabled: index === 0 || locked,
                onClick: () => {
                  onNavigate(index - 1);
                },
                children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.IconChevronLeftOutlineRegular, {})
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: question_card_module_css_default.progress, children: [
              index + 1,
              " / ",
              total
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "button",
              {
                type: "button",
                className: question_card_module_css_default.iconButton,
                "aria-label": COPY.next,
                disabled: last || locked,
                onClick: () => {
                  onNavigate(index + 1);
                },
                children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.IconChevronRightOutlineRegular, {})
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: question_card_module_css_default.feedback, role: "status", children: error }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: question_card_module_css_default.footerActions, children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", disabled: locked, onClick: () => {
              questionStore.close(entry, "skipped");
            }, children: COPY.skip }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Button, { variant: "primary", disabled: !answered || locked, onClick: () => {
              void submit();
            }, children: busy ? t("sending") : submitted ? t("sent") : t("send") })
          ] })
        ] })
      ]
    }
  );
}
function QueuedQuestionToolRow({ block, callId, sessionId }) {
  const questions = (0, import_react2.useMemo)(() => questionsFrom(block), [block]);
  const signature = JSON.stringify(questions);
  (0, import_react2.useEffect)(() => {
    if (typeof sessionId !== "string" || typeof callId !== "string" || questions.length === 0) return;
    questionStore.enqueue(sessionId, callId, questions);
  }, [sessionId, callId, signature]);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: question_card_module_css_default.toolRow, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { className: question_card_module_css_default.toolRowTitle, children: "\u5F85\u56DE\u7B54" }) });
}
function QuestionDock(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(QuestionContentContext.Provider, { value: props.renderSlot, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(QuestionDockBody, { ...props }) });
}
function QuestionDockBody({ sessionId, send, t }) {
  const target = typeof sessionId === "string" && sessionId !== "" ? sessionId : void 0;
  const entries = useQuestions(target);
  const drafts = (0, import_react2.useMemo)(() => /* @__PURE__ */ new Map(), [target]);
  const [openKey, setOpenKey] = (0, import_react2.useState)(void 0);
  const [collapsed, setCollapsed] = (0, import_react2.useState)(false);
  const answer = send ?? (() => Promise.reject(new Error("\u539F\u5BF9\u8BDD\u5C1A\u672A\u52A0\u8F7D\uFF0C\u65E0\u6CD5\u53D1\u9001\u56DE\u7B54\u3002")));
  (0, import_react2.useEffect)(() => {
    if (entries.length === 0) setOpenKey(void 0);
  }, [entries.length]);
  const newest = entries[entries.length - 1];
  const expandedKey = openKey ?? newest?.key;
  if (entries.length === 0) return null;
  const older = entries.filter((entry) => entry.key !== expandedKey);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: question_card_module_css_default.dock, "aria-label": "\u5F85\u56DE\u7B54\u7684\u95EE\u9898", "data-dsh-proactive-questions": true, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
      "button",
      {
        type: "button",
        className: question_card_module_css_default.dockBar,
        "aria-expanded": !collapsed,
        onClick: () => {
          setCollapsed((value) => !value);
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: question_card_module_css_default.dockTitle, children: "\u9700\u8981\u4F60\u7684\u610F\u89C1" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: question_card_module_css_default.dockCount, children: entries.length > 1 ? `\u5171 ${entries.length} \u4E2A` : "" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { "aria-hidden": true, className: question_card_module_css_default.dockCaret, children: collapsed ? "\u25B2" : "\u25BC" })
        ]
      }
    ),
    collapsed ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: question_card_module_css_default.dockBody, children: [
      expandedKey !== void 0 ? (() => {
        const entry = entries.find((candidate) => candidate.key === expandedKey);
        if (entry === void 0) return null;
        return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          QuestionCard,
          {
            entry,
            send: answer,
            t,
            index: entries.findIndex((candidate) => candidate.key === entry.key),
            total: entries.length,
            drafts,
            onClose: () => {
              setCollapsed(true);
            },
            onNavigate: (index) => {
              setOpenKey(entries[index]?.key);
            }
          },
          entry.key
        );
      })() : null,
      older.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: question_card_module_css_default.olderRow, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: question_card_module_css_default.olderLabel, children: entry.question.question }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: question_card_module_css_default.linkButton, onClick: () => {
          setOpenKey(entry.key);
        }, children: "\u56DE\u7B54" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: question_card_module_css_default.linkButtonMuted, onClick: () => {
          questionStore.close(entry, "skipped");
        }, children: "\u8DF3\u8FC7" })
      ] }, entry.key)),
      entries.length > 1 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: question_card_module_css_default.skipAllRow, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        "button",
        {
          type: "button",
          className: question_card_module_css_default.skipAll,
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
    const conversation = scope.get("conversation");
    if (conversation === void 0) throw new Error("\u539F\u5BF9\u8BDD\u7684\u4F1A\u8BDD\u670D\u52A1\u5F53\u524D\u4E0D\u53EF\u7528\uFF0C\u65E0\u6CD5\u53D1\u9001\u56DE\u7B54\u3002");
    return await conversation.send(text);
  };
}

// src/client/answer-view.tsx
var import_react3 = require("react");
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");

// dsh-css: dsh-css:G:\DigitalLife\DSHPlugins\packages\dsh-proactive-questioning\src\client\answer-view.module.css.mjs
var css2 = "._0S-7yG_row{flex-direction:column;align-items:flex-end;gap:6px;min-width:0;display:flex}._0S-7yG_stack{width:100%;min-width:0;max-width:min(calc(var(--dsh-chat-content-width,748px) * .702), 82%);flex-direction:column;align-items:flex-end;gap:8px;display:flex}._0S-7yG_bubble,._0S-7yG_receipt{border-radius:var(--dsw-radius-xl);max-width:100%;color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));overflow-wrap:anywhere}._0S-7yG_bubble{background:var(--dsw-specific-bubble);white-space:pre-wrap;padding:10px 16px}._0S-7yG_receipt{box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);width:fit-content;max-width:min(480px,100%);box-shadow:var(--dsw-elevation-panel);line-height:calc(20px + var(--dsh-content-font-delta,0px));border:0;border-radius:12px;overflow:hidden}._0S-7yG_header{justify-content:space-between;align-items:flex-start;gap:8px;padding:8px 12px;display:flex}._0S-7yG_question{min-width:0;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;flex:1}._0S-7yG_status{font-size:var(--dsh-content-font-size-tertiary,12px);flex-shrink:0;line-height:20px}._0S-7yG_answer{background:var(--dsw-specific-bubble);padding:8px 12px}._0S-7yG_selections{flex-direction:column;gap:4px;margin:0;padding:0;list-style:none;display:flex}._0S-7yG_selections li{align-items:baseline;gap:6px;display:flex}._0S-7yG_selections li>:first-child{flex-shrink:0}._0S-7yG_custom{white-space:pre-wrap}._0S-7yG_selections+._0S-7yG_custom{margin-top:6px}._0S-7yG_caption,._0S-7yG_actions{color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:18px}._0S-7yG_caption{margin-bottom:4px}._0S-7yG_actions{align-items:center;gap:6px;display:flex}._0S-7yG_actions button{padding:4px}._0S-7yG_attachments{flex-wrap:wrap;justify-content:flex-end;gap:8px;max-width:100%;display:flex}._0S-7yG_file{border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);min-width:0;max-width:100%;color:var(--dsw-alias-label-primary);align-items:center;gap:8px;padding:10px 12px;display:flex}._0S-7yG_fileCopy{overflow-wrap:anywhere;flex-direction:column;min-width:0;display:flex}._0S-7yG_fileCopy small{color:var(--dsw-alias-label-tertiary)}@media (width<=480px){._0S-7yG_stack{max-width:92%}}";
var tagId2 = "dsh-proactive-questioning/answer-view.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId2) + "]") === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-proactive-questioning";
  tag.dataset.pluginCss = tagId2;
  tag.textContent = css2;
  document.head.appendChild(tag);
}
var answer_view_module_css_default = { "fileCopy": "_0S-7yG_fileCopy", "stack": "_0S-7yG_stack", "receipt": "_0S-7yG_receipt", "row": "_0S-7yG_row", "file": "_0S-7yG_file", "answer": "_0S-7yG_answer", "attachments": "_0S-7yG_attachments", "bubble": "_0S-7yG_bubble", "status": "_0S-7yG_status", "header": "_0S-7yG_header", "actions": "_0S-7yG_actions", "caption": "_0S-7yG_caption", "question": "_0S-7yG_question", "selections": "_0S-7yG_selections", "custom": "_0S-7yG_custom" };

// src/client/answer-view.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
function AnswerMessageFactory(props) {
  const text = props.node.data.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("");
  return parseAnswerText(text) === void 0 ? props.fallback : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(AnswerMessageView, { ...props });
}
function AnswerMessageView(props) {
  const { node, renderMessageImages, openFile, openSkill, renderFactorySlot, t } = props;
  const data = node.data;
  const text = data.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("");
  const answer = parseAnswerText(text);
  const [copied, setCopied] = (0, import_react3.useState)(false);
  const [copyError, setCopyError] = (0, import_react3.useState)(false);
  const copying = (0, import_react3.useRef)(false);
  const epoch = (0, import_react3.useRef)(0);
  (0, import_react3.useEffect)(() => {
    epoch.current += 1;
    setCopied(false);
    setCopyError(false);
    return () => {
      epoch.current += 1;
    };
  }, [text]);
  const copy = async () => {
    if (copying.current) return;
    copying.current = true;
    const current = epoch.current;
    try {
      const ok = await (0, import_dsh_client_ui_primitives2.writeClipboard)(text);
      if (current !== epoch.current) return;
      setCopied(ok);
      setCopyError(!ok);
    } catch (error) {
      if (current === epoch.current) setCopyError(true);
    } finally {
      copying.current = false;
    }
  };
  const attachments = data.content.filter((block) => block.type === "image" || block.type === "file");
  const extra = data.content.filter((block) => !["text", "image", "file"].includes(block.type));
  const references = data.referenceLabels ?? [];
  const renderText = (value, sessionLabels = [], skillNames = []) => typeof import_dsh_client_ui_primitives2.projectUserText === "function" ? (0, import_dsh_client_ui_primitives2.projectUserText)(value, sessionLabels, skillNames, "skill", { openFile, openSkill }) : renderFactorySlot("conversation.user.text", { text: value, facts: { sessionLabels, skillNames }, interactive: true });
  const time = new Date(data.time);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: answer_view_module_css_default.row, "data-dsh-answer-message": answer === void 0 ? void 0 : "", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: answer_view_module_css_default.stack, children: [
      attachments.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: answer_view_module_css_default.attachments, "data-message-attachments": true, children: attachments.map((block, index) => block.type === "image" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_react3.Fragment, { children: renderMessageImages({ images: [{ attachment: block.attachment }], align: "end", compact: attachments.length > 1 }) }, index) : block.type === "file" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: answer_view_module_css_default.file, title: block.attachment.name, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.FileTypeIcon, { path: block.attachment.name }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: answer_view_module_css_default.fileCopy, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: block.attachment.name }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("small", { children: [(0, import_dsh_client_ui_primitives2.fileExtension)(block.attachment.name).toUpperCase().slice(0, 8), (0, import_dsh_client_ui_primitives2.fileSizeText)(block.attachment.bytes)].filter(Boolean).join(" ") })
        ] })
      ] }, index) : null) }),
      answer !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: answer_view_module_css_default.receipt, "aria-label": t("answered"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("header", { className: answer_view_module_css_default.header, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: answer_view_module_css_default.question, children: renderText(answer.question) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: answer_view_module_css_default.status, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Tag, { tone: "success", children: t("answered") }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: answer_view_module_css_default.answer, children: [
          answer.selected.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("ul", { className: answer_view_module_css_default.selections, children: answer.selected.map((label, index) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("li", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconCheckOutlineRegular, { size: 14 }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: parseRecommendedLabel(label).label })
          ] }, index)) }),
          answer.custom !== "" && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: answer_view_module_css_default.custom, children: [
            answer.selected.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: answer_view_module_css_default.caption, children: t("supplement") }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { children: renderText(answer.custom) })
          ] })
        ] })
      ] }) : (text !== "" || extra.length > 0) && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: answer_view_module_css_default.bubble, children: renderText(text, references, data.skillNames ?? []) }),
      extra.map((block, index) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.JsonBlock, { label: t("extra"), payload: block, truncatedLabel: (total) => t("truncated", { total }) }, index)),
      references.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: answer_view_module_css_default.caption, children: t("references", { labels: references.join("\u3001") }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: answer_view_module_css_default.actions, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("time", { dateTime: time.toISOString(), title: time.toLocaleString(), children: time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Tooltip, { label: copied ? t("copied") : t("copy"), side: "bottom", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Button, { variant: "ghost", "aria-label": copied ? t("copied") : t("copy"), onClick: () => {
        void copy();
      }, children: copied ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconCheckOutlineRegular, {}) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconCopyOutlineRegular, {}) }) }),
      copyError && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { role: "status", children: t("copyFailed") })
    ] })
  ] });
}

// src/client/answer-locales.ts
var answerLocales = {
  zh: {
    send: "\u53D1\u9001\u56DE\u7B54",
    sending: "\u53D1\u9001\u4E2D\u2026",
    sent: "\u5DF2\u53D1\u9001",
    answered: "\u5DF2\u56DE\u7B54",
    question: "\u95EE\u9898",
    answer: "\u56DE\u7B54",
    supplement: "\u8865\u5145",
    copy: "\u590D\u5236",
    copied: "\u5DF2\u590D\u5236",
    copyFailed: "\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5",
    extra: "\u9644\u52A0\u5185\u5BB9",
    truncated: "\u5DF2\u7701\u7565 {total} \u9879",
    references: "\u5F15\u7528\uFF1A{labels}"
  },
  en: {
    send: "Send answer",
    sending: "Sending\u2026",
    sent: "Sent",
    answered: "Answered",
    question: "Question",
    answer: "Answer",
    supplement: "Additional details",
    copy: "Copy",
    copied: "Copied",
    copyFailed: "Copy failed. Try again.",
    extra: "Additional content",
    truncated: "{total} items omitted",
    references: "References: {labels}"
  }
};

// src/client/index.ts
var inject = ["slots", "sessions", "locale"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register("proactive-answer", answerLocales));
  ctx.effect(() => ctx.slots.registerFactory({ name: "proactive-answer.message", locale: "proactive-answer" }, AnswerMessageFactory));
  for (const key of ["user", "steering"]) {
    ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
      name: "conversation.chat.node",
      key,
      priority: -5,
      locale: "proactive-answer"
    }, AnswerMessageView));
  }
  ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
    name: "tool.call.toolview",
    key: "queue_user_question",
    locale: "conversation"
  }, QueuedQuestionToolRow));
  ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
    name: "conversation.input.dock",
    id: "proactive-questioning-dock",
    children: { "proactive.question.content": { kind: "single", scope: "session" } },
    order: 15,
    locale: "proactive-answer",
    inject: (sessionId) => {
      const send = scopedSend(ctx, asSessionId(sessionId));
      return send === void 0 ? {} : { send };
    }
  }, QuestionDock));
}

    return module.exports
  },
})
