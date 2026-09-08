import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { QueuedQuestionToolRow, QuestionBubble, QuestionDock } from './components.tsx'

export const inject = ['slots', 'sessions']

/** Mount one non-blocking question queue per conversation; no Rabi or emotional-data dependency exists here. */
export function apply(ctx: ClientContext): void {
  const send = (sessionId: string) => async (text: string): Promise<unknown> => {
    const scope = ctx.sessions.scope(sessionId)
    if (scope === undefined) throw new Error('原对话尚未加载，无法发送回答。')
    return await scope.conversation.send(text)
  }
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview', key: 'queue_user_question', locale: 'conversation',
  }, QueuedQuestionToolRow))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'proactive-questioning-dock', order: 15,
    inject: (sessionId: string) => ({ sessionId, send: send(sessionId) }),
  }, QuestionDock))
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left', id: 'proactive-questioning-bubble', order: 5,
    inject: (sessionId: string) => ({ sessionId, send: send(sessionId) }),
  }, QuestionBubble))
}
