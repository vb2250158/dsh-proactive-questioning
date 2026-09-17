import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { QueuedQuestionToolRow, QuestionDock } from './components.tsx'
import { asSessionId, scopedSend } from './host.ts'

export const inject = ['slots', 'sessions']

/** Mount one non-blocking question queue per conversation; no Rabi or emotional-data dependency exists here. */
export function apply(ctx: ClientContext): void {
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
    order: 15,
    locale: 'conversation',
    inject: (sessionId: unknown): { send?: (text: string) => Promise<unknown> } => ({
      send: scopedSend(ctx, asSessionId(sessionId)),
    }),
  }, QuestionDock))
}
