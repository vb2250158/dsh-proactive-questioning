// src/index.ts
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";

// src/protocol.mjs
var MAX_QUESTIONS = 3;
var MAX_OPTIONS = 8;
function fail(message) {
  throw new TypeError(message);
}
function text(value, field, max) {
  if (typeof value !== "string") fail(`${field} \u5FC5\u987B\u662F\u6587\u5B57\u3002`);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > max) fail(`${field} \u957F\u5EA6\u65E0\u6548\u3002`);
  return normalized;
}
function normalizeQuestions(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("\u63D0\u95EE\u53C2\u6570\u5FC5\u987B\u662F\u5BF9\u8C61\u3002");
  const source = value.questions;
  if (!Array.isArray(source) || source.length === 0 || source.length > MAX_QUESTIONS) {
    fail(`\u6BCF\u6B21\u53EF\u63D0\u51FA 1 \u5230 ${MAX_QUESTIONS} \u4E2A\u975E\u963B\u585E\u95EE\u9898\u3002`);
  }
  const ids = /* @__PURE__ */ new Set();
  return source.map((candidate, index) => {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) fail(`\u7B2C ${index + 1} \u4E2A\u95EE\u9898\u65E0\u6548\u3002`);
    const item = candidate;
    const id = text(item.id, `\u7B2C ${index + 1} \u4E2A\u95EE\u9898 id`, 96);
    if (ids.has(id)) fail("\u540C\u4E00\u6B21\u8C03\u7528\u7684\u95EE\u9898 id \u4E0D\u80FD\u91CD\u590D\u3002");
    ids.add(id);
    const question = text(item.question, `\u7B2C ${index + 1} \u4E2A\u95EE\u9898`, 1200);
    const header = item.header === void 0 ? void 0 : text(item.header, `\u7B2C ${index + 1} \u4E2A\u95EE\u9898\u6807\u9898`, 120);
    let options;
    if (item.options !== void 0) {
      if (!Array.isArray(item.options) || item.options.length === 0 || item.options.length > MAX_OPTIONS) {
        fail(`\u7B2C ${index + 1} \u4E2A\u95EE\u9898\u7684\u9009\u9879\u6570\u91CF\u65E0\u6548\u3002`);
      }
      const labels = /* @__PURE__ */ new Set();
      options = item.options.map((option, optionIndex) => {
        if (option === null || typeof option !== "object" || Array.isArray(option)) fail(`\u7B2C ${index + 1} \u4E2A\u95EE\u9898\u7684\u7B2C ${optionIndex + 1} \u4E2A\u9009\u9879\u65E0\u6548\u3002`);
        const label = text(option.label, `\u7B2C ${index + 1} \u4E2A\u95EE\u9898\u7684\u9009\u9879\u6807\u7B7E`, 120);
        if (labels.has(label)) fail(`\u7B2C ${index + 1} \u4E2A\u95EE\u9898\u7684\u9009\u9879\u4E0D\u80FD\u91CD\u590D\u3002`);
        labels.add(label);
        return {
          label,
          ...option.description === void 0 ? {} : { description: text(option.description, `\u7B2C ${index + 1} \u4E2A\u95EE\u9898\u7684\u9009\u9879\u8BF4\u660E`, 360) }
        };
      });
    }
    if (item.multi_select !== void 0 && typeof item.multi_select !== "boolean") fail(`\u7B2C ${index + 1} \u4E2A\u95EE\u9898\u7684 multi_select \u5FC5\u987B\u662F\u5E03\u5C14\u503C\u3002`);
    return {
      id,
      question,
      ...header === void 0 ? {} : { header },
      ...options === void 0 ? {} : { options },
      ...item.multi_select === true ? { multiSelect: true } : {}
    };
  });
}
function queuedResult(questions) {
  return {
    status: "queued",
    questionIds: questions.map((question) => question.id),
    continuation: "The question was shown without waiting. Continue independently and treat silence as no answer."
  };
}

// src/index.ts
var name = "proactive-questioning";
var inject = ["tools", "systemPrompt"];
var Config = z.object({ enabled: z.boolean().default(true) });
var POLICY = `Use queue_user_question when knowing the user's preference, taste, priority, or idea would improve the result, but you can continue safely without it. It immediately creates a per-conversation question bubble with options and a free-text reply; it never waits, blocks a tool call, or has a timeout. Continue the task after calling it. A user may answer later, skip it, close it, or never answer; silence is not consent, a decision, or an answer. Later replies arrive as ordinary user messages.

Ask only concise, useful questions (at most three per call). Offer options where they clarify a real tradeoff and put a recommendation first when one exists. Do not use a question to request permission for ordinary safe inspection, to defer work you can complete, or to make a real-person relationship claim. Do not call the blocking ask_user_question in this deployment: use queue_user_question for all optional consultation. If a missing decision is truly essential, state the precise boundary and wait for an ordinary user message rather than blocking the running turn.`;
function apply(ctx, config = {}) {
  if (config.enabled === false) return;
  ctx.systemPrompt.section({
    name: "private:proactive-questioning",
    order: 650,
    text: POLICY
  });
  ctx.tools.register(defineTool({
    name: "queue_user_question",
    description: "Queue a concise optional question for this conversation without blocking your reasoning. The question appears briefly above the input, then becomes a per-conversation bubble with options, free text, skip, and close. This tool returns immediately; continue the task and do not assume an answer.",
    parameters: {
      questions: {
        type: "array",
        required: true,
        description: "One to three optional user questions to queue without waiting.",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            id: { type: "string", required: true, description: "Stable id within this tool call." },
            question: { type: "string", required: true, description: "Specific concise question." },
            header: { type: "string", description: "Optional short category heading." },
            options: {
              type: "array",
              description: "Optional selectable choices. A free-text answer is always also available.",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  label: { type: "string", required: true, description: "Short choice label." },
                  description: { type: "string", description: "One-sentence tradeoff or impact." }
                }
              }
            },
            multi_select: { type: "boolean", description: "Permit more than one selected option." }
          }
        }
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", required: true },
          questionIds: { type: "array", required: true, items: { type: "string" } },
          continuation: { type: "string", required: true }
        }
      },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
    },
    execute(args) {
      return queuedResult(normalizeQuestions(args));
    }
  }));
}
export {
  Config,
  apply,
  inject,
  name
};
