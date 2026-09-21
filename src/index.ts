import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { normalizeQuestions, queuedResult } from './protocol.mjs'

export const name = 'proactive-questioning'
export const inject = ['tools', 'systemPrompt']

export interface Config { enabled?: boolean }

export const Config: z<Config> = z.object({ enabled: z.boolean().default(true) })

const POLICY = `Use queue_user_question when knowing the user's preference, taste, priority, or idea would improve the result, but you can continue safely without it. It immediately creates a per-conversation question bubble with options and a free-text reply; it never waits, blocks a tool call, or has a timeout. Continue the task after calling it. A user may answer later, skip it, close it, or never answer; silence is not consent, a decision, or an answer. Later replies arrive as ordinary user messages.

Ask only concise, useful questions (at most three per call). Offer options where they clarify a real tradeoff and put a recommendation first when one exists. Do not use a question to request permission for ordinary safe inspection, to defer work you can complete, or to make a real-person relationship claim. Do not call the blocking ask_user_question in this deployment: use queue_user_question for all optional consultation. If a missing decision is truly essential, state the precise boundary and wait for an ordinary user message rather than blocking the running turn.`

export function apply(ctx: Context, config: Config = {}): void {
  if (config.enabled === false) return
  ctx.systemPrompt.section({
    name: 'private:proactive-questioning',
    order: 650,
    text: POLICY,
  })
  ctx.tools.register(defineTool({
    name: 'queue_user_question',
    description: 'Queue a concise optional question for this conversation without blocking your reasoning. '
      + 'The question appears briefly above the input, then becomes a per-conversation bubble with options, free text, skip, and close. '
      + 'This tool returns immediately; continue the task and do not assume an answer.',
    parameters: {
      questions: {
        type: 'array',
        required: true,
        description: 'One to three optional user questions to queue without waiting.',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            id: { type: 'string', required: true, description: 'Stable id within this tool call.' },
            question: { type: 'string', required: true, description: 'Specific concise question.' },
            detail: { type: 'string', description: 'Optional explanatory Markdown, up to 12000 characters. With chat enhancement installed, mix text and images using ![alt](https://...) or an absolute local file path (use forward slashes on Windows; wrap paths containing spaces in angle brackets). Keep the question itself concise.' },
            header: { type: 'string', description: 'Optional short category heading.' },
            options: {
              type: 'array',
              description: 'Optional selectable choices. A free-text answer is always also available.',
              items: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  label: { type: 'string', required: true, description: 'Short choice label.' },
                  description: { type: 'string', description: 'Tradeoff or impact, up to 12000 characters. With chat enhancement installed, Markdown images may be interleaved with text, using the same syntax as detail. Keep label as a short plain-text choice.' },
                },
              },
            },
            multi_select: { type: 'boolean', description: 'Permit more than one selected option.' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          status: { type: 'string', required: true },
          questionIds: { type: 'array', required: true, items: { type: 'string' } },
          continuation: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      return queuedResult(normalizeQuestions(args))
    },
  }))
}
