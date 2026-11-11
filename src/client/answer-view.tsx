/** Present a structured answer inside the official user-message row. */
import type { UserTextNodeProps, UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { IconCheckOutlineRegular, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { parseAnswerText } from './answer-message.mjs'
import { parseRecommendedLabel } from './components.tsx'
import css from './answer-view.module.css'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap {
    'proactive-answer': { readonly question: string; readonly selected: readonly string[]; readonly custom: string }
  }
}

/** Match only a complete answer envelope, leaving ordinary text to the host. */
export const answerTextRule: UserTextRule<'proactive-answer'> = {
  id: 'proactive-answer', order: 10,
  match(text, from) {
    if (from !== 0) return undefined
    const answer = parseAnswerText(text)
    return answer === undefined ? undefined : { id: 'proactive-answer', start: 0, end: text.length, data: answer }
  },
}

/** Render only the answer content; the host owns the row and its actions. */
export function AnswerTextNode({ node, t }: UserTextNodeProps<'proactive-answer'> & { t: (key: string) => string }) {
  const answer = node.data
  return <span className={css.receipt} data-dsh-answer-message="" aria-label={t('answered')}>
    <span className={css.header}>
      <span className={css.question}>{answer.question}</span>
      <span className={css.status}><Tag tone="success">{t('answered')}</Tag></span>
    </span>
    <span className={css.answer}>
      {answer.selected.length > 0 && <span className={css.selections} role="list">
        {answer.selected.map((label, index) => <span key={index} role="listitem"><IconCheckOutlineRegular size={14} /><span>{parseRecommendedLabel(label).label}</span></span>)}
      </span>}
      {answer.custom !== '' && <span className={css.custom}>
        {answer.selected.length > 0 && <span className={css.caption}>{t('supplement')}</span>}
        <span>{answer.custom}</span>
      </span>}
    </span>
  </span>
}
