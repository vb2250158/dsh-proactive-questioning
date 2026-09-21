/** 问题内容扩展点；没有增强插件时保留原文。 */
import { createContext, useContext } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'proactive.question.content': { kind: 'single'; scope: 'session'; owner: { text: string } }
  }
}

export type QuestionContentSlots = PropsRenderSlots<'proactive.question.content'>
export const QuestionContentContext = createContext<QuestionContentSlots['renderSlot'] | undefined>(undefined)

/** 扩展渲染仅接收显示文本，不获得选择、关闭或发送权限。 */
export function QuestionContent({ text }: { text: string }) {
  const render = useContext(QuestionContentContext)
  return <>{render === undefined ? text : render('proactive.question.content', { text }, { fallback: text })}</>
}
