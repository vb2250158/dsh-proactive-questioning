import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { QueuedQuestionToolRow, QuestionDock } from './components.tsx'
import { contextFromProps, sessionBinding } from './host.ts'

export const inject = ['slots', 'sessions']

/** Session identity of one dock occurrence, from the standard `sessionId` prop. */
function dockSessionId(props: object): string | undefined {
  const value = (props as { sessionId?: unknown }).sessionId
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Mount one non-blocking question queue per conversation; no Rabi or emotional-data dependency exists here. */
export function apply(ctx: ClientContext): void {
  const send = (sessionId: string) => async (text: string): Promise<unknown> => {
    const scope = ctx.sessions.scope(sessionId)
    if (scope === undefined) throw new Error('原对话尚未加载，无法发送回答。')
    return await scope.conversation.send(text)
  }
  /**
   * One dock occurrence's inject face.
   *
   * The occurrence context is read off the props: `main.conversation` (which
   * owns the composer, and therefore this dock) resolves to the current
   * Session's scoped context, and its Session standard kit is a selector over
   * the *current* Session — so an occurrence mounted for a non-current Session
   * would otherwise read the wrong Session's questions. Resolving through
   * `uiSession.adapter` by identity keeps each occurrence on its own Session,
   * and the answer is addressed to that identity explicitly.
   */
  const dockInjected = (props: object) => {
    const context = contextFromProps(props)
    const sessionId = dockSessionId(props)
    const binding = sessionId === undefined ? undefined : sessionBinding(context, sessionId)
    return {
      ctx: context,
      sessionId,
      binding,
      send: (text: string) => sessionId === undefined || binding === undefined
        ? Promise.reject(new Error('原对话尚未加载，无法发送回答。'))
        : send(sessionId)(text),
    }
  }
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview', key: 'queue_user_question', locale: 'conversation',
  }, QueuedQuestionToolRow))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'proactive-questioning-dock', order: 15, locale: 'conversation',
    inject: dockInjected,
  }, QuestionDock))
}
