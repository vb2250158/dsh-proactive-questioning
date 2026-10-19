/** User and steering message presentation through the public keyed Chat renderer. */
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { MessageImagesOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  Button, FileTypeIcon, IconCheckOutlineRegular, IconCopyOutlineRegular, JsonBlock,
  Tag, Tooltip, fileExtension, fileSizeText, projectUserText, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { parseAnswerText } from './answer-message.mjs'
import { parseRecommendedLabel } from './components.tsx'
import css from './answer-view.module.css'

/** Caller-owned inputs for answer presentation inside another message renderer. */
type LegacyMessageProps = {
  renderMessageImages?: (owner: Omit<MessageImagesOwnerProps, 'loadImage'>) => ReactNode
  openSkill?: (name: string) => void
}

export type AnswerFactoryInput = Pick<ChatNodeViewProps<'user' | 'steering'>, 'node' | 'loadImage' | 'openFile'> & LegacyMessageProps & { fallback: ReactNode }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotFactoryMap {
    'proactive-answer.message': { props: AnswerFactoryInput; locale: 'proactive-answer' }
  }
}

/**
 * Render complete answer envelopes; preserve the caller's ordinary-message presentation otherwise.
 * @param props - message inputs, localized copy and the caller's fallback.
 * @returns the answer card or the original presentation.
 */
export function AnswerMessageFactory(props: AnswerFactoryInput & Pick<ChatNodeViewProps<'user'>, 'renderFactorySlot'> & { t: (key: string, values?: Record<string, string | number>) => string }) {
  const text = props.node.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
  return parseAnswerText(text) === undefined ? props.fallback : <AnswerMessageView {...props} />
}

/** Render recognized answers as receipts; retain text, attachments, references and copy for all other messages. */
export function AnswerMessageView(props: Omit<ChatNodeViewProps<'user' | 'steering'>, 't'> & {
  t: (key: string, values?: Record<string, string | number>) => string
} & LegacyMessageProps) {
  const { node, renderMessageImages, loadImage, openFile, openSkill, renderFactorySlot, t } = props
  const data = node.data
  const text = data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
  const answer = parseAnswerText(text)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const copying = useRef(false)
  const epoch = useRef(0)
  useEffect(() => {
    epoch.current += 1
    setCopied(false)
    setCopyError(false)
    return () => { epoch.current += 1 }
  }, [text])
  const copy = async (): Promise<void> => {
    if (copying.current) return
    copying.current = true
    const current = epoch.current
    try {
      const ok = await writeClipboard(text)
      if (current !== epoch.current) return
      setCopied(ok)
      setCopyError(!ok)
    } catch (error) {
      if (current === epoch.current) setCopyError(true)
    } finally {
      copying.current = false
    }
  }
  const attachments = data.content.filter(block => block.type === 'image' || block.type === 'file')
  const extra = data.content.filter(block => !['text', 'image', 'file'].includes(block.type))
  const references = data.referenceLabels ?? []
  const renderText = (value: string, sessionLabels: readonly string[] = [], skillNames: readonly string[] = []) =>
    typeof projectUserText === 'function'
      ? projectUserText(value, sessionLabels, skillNames, 'skill', { openFile, openSkill })
      : renderFactorySlot('conversation.user.text', { text: value, facts: { sessionLabels, skillNames }, interactive: true })
  const time = new Date(data.time)
  return <div className={css.row} data-dsh-answer-message={answer === undefined ? undefined : ''}>
      <div className={css.stack}>
        {attachments.length > 0 && <div className={css.attachments} data-message-attachments>
          {attachments.map((block, index) => block.type === 'image'
            ? <Fragment key={index}>{typeof renderMessageImages === 'function'
              ? renderMessageImages({ images: [{ attachment: block.attachment }], align: 'end', compact: attachments.length > 1 })
              : renderFactorySlot('conversation.images.content', { images: [{ attachment: block.attachment }], loadImage, align: 'end', compact: attachments.length > 1 })}</Fragment>
            : block.type === 'file' ? <span key={index} className={css.file} title={block.attachment.name}>
                <FileTypeIcon path={block.attachment.name} />
                <span className={css.fileCopy}><span>{block.attachment.name}</span>
                  <small>{[fileExtension(block.attachment.name).toUpperCase().slice(0, 8), fileSizeText(block.attachment.bytes)].filter(Boolean).join(' ')}</small>
                </span>
              </span> : null)}
        </div>}
        {answer !== undefined ? <section className={css.receipt} aria-label={t('answered')}>
          <header className={css.header}>
            <div className={css.question}>{renderText(answer.question)}</div>
            <span className={css.status}><Tag tone="success">{t('answered')}</Tag></span>
          </header>
          <div className={css.answer}>
            {answer.selected.length > 0 && <ul className={css.selections}>
              {answer.selected.map((label: string, index: number) => <li key={index}><IconCheckOutlineRegular size={14} /><span>{parseRecommendedLabel(label).label}</span></li>)}
            </ul>}
            {answer.custom !== '' && <div className={css.custom}>
              {answer.selected.length > 0 && <div className={css.caption}>{t('supplement')}</div>}
              <div>{renderText(answer.custom)}</div>
            </div>}
          </div>
        </section> : (text !== '' || extra.length > 0) && <div className={css.bubble}>
          {renderText(text, references, data.skillNames ?? [])}
        </div>}
        {extra.map((block, index) => <JsonBlock key={index} label={t('extra')} payload={block} truncatedLabel={total => t('truncated', { total })} />)}
        {references.length > 0 && <div className={css.caption}>{t('references', { labels: references.join('、') })}</div>}
      </div>
      <div className={css.actions}>
        <time dateTime={time.toISOString()} title={time.toLocaleString()}>{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
        <Tooltip label={copied ? t('copied') : t('copy')} side="bottom">
          <Button variant="ghost" aria-label={copied ? t('copied') : t('copy')} onClick={() => { void copy() }}>
            {copied ? <IconCheckOutlineRegular /> : <IconCopyOutlineRegular />}
          </Button>
        </Tooltip>
        {copyError && <span role="status">{t('copyFailed')}</span>}
      </div>
    </div>
}
