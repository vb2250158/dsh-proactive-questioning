import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { QueuedQuestionToolRow, QuestionDock } from './components.tsx'
import { asSessionId, scopedSend } from './host.ts'
import { AnswerMessageFactory, AnswerMessageView } from './answer-view.tsx'
import { answerLocales } from './answer-locales.ts'

export const inject = ['slots', 'sessions', 'locale']

/** Mount one non-blocking question queue per conversation; no Rabi or emotional-data dependency exists here. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('proactive-answer', answerLocales))
  ctx.effect(() => ctx.slots.registerFactory({ name: 'proactive-answer.message', locale: 'proactive-answer' }, AnswerMessageFactory))
  for (const key of ['user', 'steering'] as const) {
    ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
      name: 'conversation.chat.node', key, priority: -5, locale: 'proactive-answer',
    }, AnswerMessageView))
  }
  /**
   * The Tool row's only job is to mirror the call into the store. Identity
   * comes from the framework's Session standard props (`sessionId`), which
   * `ui-tool`'s `ToolCallOwnerProps` is composed with — the shipped
   * `ask_user_question` view does the same, and neither needs an inject face.
   */
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview', key: 'queue_user_question', locale: 'conversation',
  }, QueuedQuestionToolRow))

  /**
   * One dock occurrence per Session, full width above the composer card.
   *
   * This is a `session`-scope slot, so the registration declares the inject
   * face and the framework calls it as `inject(sessionId)` — the id is a
   * positional argument derived from the declaration, not a field on an
   * argument object. `ui-goal`'s `GoalDock` occupies this same slot with that
   * exact signature. Reading identity out of a props parameter here yields
   * `undefined` for every occurrence, which renders no dock at all; that was
   * the long-standing reason a queued question never appeared.
   */
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'proactive-questioning-dock',
    children: { 'proactive.question.content': { kind: 'single', scope: 'session' } },
    order: 15,
    locale: 'proactive-answer',
    inject: (sessionId: unknown): { send?: (text: string) => Promise<unknown> } => { const send = scopedSend(ctx, asSessionId(sessionId)); return send === undefined ? {} : { send } },
  }, QuestionDock))
}
