/** User and steering message presentation through the public keyed Chat renderer. */
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ChatNodeViewProps, UserContentAttachment, UserContentInput, UserRowInput } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { MessageImagesOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-skill/client'
import {
  Button, FileTypeIcon, IconCheckOutlineRegular, IconCopyOutlineRegular, JsonBlock,
  Tag, Tooltip, fileExtension, fileSizeText, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { parseAnswerText } from './answer-message.mjs'
import { parseRecommendedLabel } from './components.tsx'
import css from './answer-view.module.css'

/** Caller-owned inputs for answer presentation inside another message renderer. */
type LegacyMessageProps = {
  renderMessageImages?: (owner: Omit<MessageImagesOwnerProps, 'loadImage'>) => ReactNode
  openSkill?: (name: string) => void
}

type DurableAnswerInput = Pick<ChatNodeViewProps<'user' | 'steering'>, 'node' | 'loadImage' | 'openFile'> & LegacyMessageProps

/** Prepared rows keep local attachment previews and their real admission identity. */
export type AnswerFactoryInput = (DurableAnswerInput | { row: UserRowInput }) & { fallback: ReactNode }

type AnswerSeats = Pick<ChatNodeViewProps<'user'>, 'renderFactorySlot'> & {
  t: (key: string, values?: Record<string, string | number>) => string
}

interface PreparedAnswerInput extends UserContentInput, LegacyMessageProps {
  time?: number
  echo: boolean
  pending: boolean
  batchStart: boolean
  openFile?: DurableAnswerInput['openFile']
}

/** Normalize durable adapters and prepared rows without inventing transcript coordinates. */
function prepareAnswer(input: DurableAnswerInput | { row: UserRowInput }): PreparedAnswerInput {
  if ('row' in input) {
    const { row } = input
    const { origin } = row
    const node = origin.kind === 'durable' ? origin.node : undefined
    const time = origin.kind === 'submission' ? origin.submission.time : node?.data.time
    return {
      ...row,
      ...(time === undefined ? {} : { time }),
      echo: origin.kind === 'submission',
      pending: origin.kind === 'pending-steering' || origin.kind === 'submission' && origin.submission.placement === 'steering',
      batchStart: node?.kind === 'steering' && node.data.batchStart === true,
    }
  }
  const { node, loadImage, openFile, openSkill, renderMessageImages } = input
  const { data } = node
  return {
    content: {
      text: data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join(''),
      attachments: data.content.flatMap<UserContentAttachment>(block => block.type === 'image'
        ? [{ type: 'image' as const, image: { attachment: block.attachment } }]
        : block.type === 'file' ? [{ type: 'file' as const, file: block.attachment }] : []),
      extraBlocks: data.content.filter(block => !['text', 'image', 'file'].includes(block.type)),
      referenceLabels: data.referenceLabels ?? [],
    },
    facts: { sessionLabels: data.referenceLabels ?? [], skillNames: data.skillNames ?? [] },
    loadImage, openFile, interactive: true,
    ...(openSkill === undefined ? {} : { openSkill }),
    ...(renderMessageImages === undefined ? {} : { renderMessageImages }),
    time: data.time, echo: false, pending: false,
    batchStart: node.kind === 'steering' && node.data.batchStart === true,
  }
}

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
export function AnswerMessageFactory(props: AnswerFactoryInput & AnswerSeats) {
  const prepared = prepareAnswer(props)
  return parseAnswerText(prepared.content.text) === undefined ? props.fallback : <PreparedAnswerRow {...prepared} renderFactorySlot={props.renderFactorySlot} t={props.t} />
}

/** Render recognized answers as receipts; retain text, attachments, references and copy for all other messages. */
export function AnswerMessageView(props: Omit<ChatNodeViewProps<'user' | 'steering'>, 't'> & {
  t: (key: string, values?: Record<string, string | number>) => string
} & LegacyMessageProps) {
  return <PreparedAnswerRow {...prepareAnswer(props)} renderFactorySlot={props.renderFactorySlot} t={props.t} />
}

/** One receipt and ordinary-message renderer for local, pending and durable inputs. */
function PreparedAnswerRow({ content, facts, interactive = false, time: sentTime, echo, pending, batchStart,
  renderMessageImages, loadImage, renderFactorySlot, t }: PreparedAnswerInput & AnswerSeats) {
  const { text, attachments, extraBlocks: extra } = content
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
  const references = content.referenceLabels ?? facts.sessionLabels ?? []
  const renderText = (value: string, sessionLabels: readonly string[] = [], skillNames: readonly string[] = []) =>
    renderFactorySlot('conversation.user.text', { text: value, facts: { ...facts, sessionLabels, skillNames }, interactive })
  const time = sentTime === undefined ? undefined : new Date(sentTime)
  return <div className={css.row} data-dsh-answer-message={answer === undefined ? undefined : ''}
    data-submission-echo={echo || undefined} data-pending-steering={pending || undefined}
    data-chat-steering-batch={batchStart ? 'start' : undefined}>
      <div className={css.stack}>
        {attachments.length > 0 && <div className={css.attachments} data-message-attachments>
          {attachments.map((block, index) => block.type === 'image'
            ? <Fragment key={index}>{typeof renderMessageImages === 'function'
              ? renderMessageImages({ images: [block.image], align: 'end', compact: attachments.length > 1 })
              : renderFactorySlot('conversation.images.content', { images: [block.image], loadImage, align: 'end', compact: attachments.length > 1 })}</Fragment>
            : block.type === 'file' ? <span key={index} className={css.file} title={block.file.name}>
                <FileTypeIcon path={block.file.name} />
                <span className={css.fileCopy}><span>{block.file.name}</span>
                  <small>{[fileExtension(block.file.name).toUpperCase().slice(0, 8), fileSizeText(block.file.bytes)].filter(Boolean).join(' ')}</small>
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
          {renderText(text, references, facts.skillNames ?? [])}
        </div>}
        {extra.map((block, index) => <JsonBlock key={index} label={t('extra')} payload={block} truncatedLabel={total => t('truncated', { total })} />)}
        {references.length > 0 && <div className={css.caption}>{t('references', { labels: references.join('、') })}</div>}
      </div>
      <div className={css.actions}>
        {time !== undefined && <time dateTime={time.toISOString()} title={time.toLocaleString()}>{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}
        <Tooltip label={copied ? t('copied') : t('copy')} side="bottom">
          <Button variant="ghost" aria-label={copied ? t('copied') : t('copy')} onClick={() => { void copy() }}>
            {copied ? <IconCheckOutlineRegular /> : <IconCopyOutlineRegular />}
          </Button>
        </Tooltip>
        {copyError && <span role="status">{t('copyFailed')}</span>}
      </div>
    </div>
}
