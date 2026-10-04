import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import {
  Button, IconCheckOutlineRegular, IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular, IconCloseOutlineRegular, IconEditOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Question, QuestionEntry } from './store.ts'
import { questionStore } from './store.ts'
import { QuestionContent, QuestionContentContext, type QuestionContentSlots } from './content.tsx'
import { questionRemainingSeconds } from './lifecycle.mjs'
import css from './question-card.module.css'

type Send = (text: string) => Promise<unknown>

/**
 * One dock occurrence's runtime props.
 *
 * `sessionId` is the framework's own Session standard prop (`ui-session` merges
 * `sessionId`/`useSession`/`useProjection` into every session-scope slot), so it
 * is not something this plugin injects. `send` is the one injected verb; see
 * `index.ts` for how it is built.
 */
type DockProps = {
  sessionId?: unknown
  send?: Send
}

/**
 * The blocking card's own copy, so the two surfaces read identically.
 *
 * Restated rather than imported: `ui-user-questions` keeps these strings in a
 * package-internal `locales.ts` that registers no `ctx.locale` namespace, and
 * this plugin ships its own bundle. A string that drifts from the original is a
 * bug in this file, not a wording choice.
 */
const COPY = {
  unanswered: '请选择一个选项或填写自定义答案。',
  prev: '上一题',
  next: '下一题',
  close: '收起草稿（问题仍保留，可随时回来回答）',
  recommended: '推荐',
  customPlaceholder: '输入你的答案',
  skip: '跳过本题',
} as const

/**
 * Split the conventional recommendation suffix without changing the answer
 * value. Same rule as the blocking card's `parseRecommendedLabel`, so a question
 * authored for either surface marks its recommended option identically — and
 * selecting still sends the ORIGINAL label, which is what keeps the answer
 * meaningful to the Agent that asked.
 * @param label - Original option label returned if selected.
 * @returns Display label plus recommendation state.
 */
export function parseRecommendedLabel(label: string): { label: string, recommended: boolean } {
  const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i
  return suffix.test(label)
    ? { label: label.replace(suffix, ''), recommended: true }
    : { label, recommended: false }
}

/** Return whether a text-field key event belongs to an active IME composition. */
function isComposing(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  // keyCode 229 is the legacy IME-composition signal engines emit without isComposing.
  // oxlint-disable-next-line typescript/no-deprecated
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
}

/** The free-text answer field shared by both question variants. */
interface AnswerFieldProps {
  /** Visual variant: the custom row's inline column or the optionless question's framed block. */
  variant: 'inline' | 'block'
  /** Current draft text. */
  value: string
  /** Empty-field prompt. */
  placeholder: string
  /** Whether a submission in flight has frozen the field. */
  disabled: boolean
  /** Whether this field takes focus on mount. */
  autoFocus?: boolean
  /** Called when the field takes focus. */
  onFocus?: () => void
  /** Called with each edit of the draft. */
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  /** Called with each key press, before the browser's own handling. */
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
}

/**
 * Auto-growing free-text answer, copied from the blocking card's `AnswerField`:
 * a textarea, so a long answer soft-wraps and Shift+Enter breaks a line, over a
 * hidden mirror that owns the height.
 *
 * The mirror renders the draft plus a trailing newline in normal flow and so
 * sizes the grid row (counting rows by '\n' cannot see soft wraps); the textarea
 * shares that one cell and stretches to it, and `rows={1}` keeps the control's
 * own intrinsic height out of the row sizing so the mirror alone decides. Past
 * the mirror's cap the textarea scrolls itself. Mirror and textarea MUST share
 * font, line-height, padding and wrapping rules or the two heights diverge.
 *
 * @param props - visual variant, draft text, and the field's event handlers.
 * @returns The mirrored auto-growing field.
 */
function AnswerField(props: AnswerFieldProps) {
  return (
    <div className={`${css.field} ${props.variant === 'inline' ? css.customInline : css.customBlock}`}>
      <div aria-hidden className={css.fieldMirror}>{`${props.value}\n`}</div>
      <textarea
        autoFocus={props.autoFocus}
        className={css.fieldInput}
        value={props.value}
        disabled={props.disabled}
        rows={1}
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        onFocus={props.onFocus}
        onChange={props.onChange}
        onKeyDown={props.onKeyDown}
      />
    </div>
  )
}

/**
 * The fresh-period read-out.
 *
 * Sits in the header's action group so its right edge lines up with the blocking
 * card's close key, and borrows `.progress`' type ramp one dimmer step.
 * `settled` is NOT an expiry state: it says the accent window has passed, which
 * is all the number ever measured, and the card it sits on stays exactly as
 * usable as it was a second earlier.
 * @param askedAt - when the question was enqueued.
 * @returns the countdown node.
 */
function Countdown({ askedAt }: { askedAt: number }) {
  const remaining = questionRemainingSeconds(askedAt)
  return <span
    className={css.countdown}
    data-dsh-question-countdown
    data-state={remaining === undefined ? 'settled' : 'counting'}
    title="新鲜期剩余时间。到期后问题仍然保留，不会自动关闭。"
    aria-label={remaining === undefined ? '新鲜期已过，问题仍然保留' : `新鲜期还剩 ${String(remaining)} 秒`}
  >
    {remaining === undefined ? '已保留' : `${String(remaining)}s`}
  </span>
}

/**
 * Questions of one call.
 *
 * A Tool call reaches this view in two shapes: while it runs the arguments still
 * live on the block itself, and once it settles the block becomes a result node
 * whose `call` head carries them. Reading both is what lets the question appear
 * the moment the Agent asks it instead of after the tool returns — a question
 * shown only afterwards is one the user has usually already scrolled past.
 * @param block - the Tool call's frozen running-or-settled block.
 * @returns the validated questions, or an empty list when the call is not a
 * well-formed question set (a partially streamed argument JSON included).
 */
function questionsFrom(block: unknown): Question[] {
  const raw = readArgsRaw(block)
  if (typeof raw !== 'string' || raw === '') return []
  try {
    const parsed = JSON.parse(raw) as { questions?: unknown }
    if (!Array.isArray(parsed.questions)) return []
    const ids = new Set<string>()
    const questions: Question[] = []
    for (const item of parsed.questions) {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) return []
      const record = item as Record<string, unknown>
      if (typeof record.id !== 'string' || record.id.trim() === '' || typeof record.question !== 'string' || record.question.trim() === '' || ids.has(record.id)) return []
      ids.add(record.id)
      const options = record.options === undefined ? undefined : Array.isArray(record.options)
        ? record.options.flatMap(option => option !== null && typeof option === 'object' && !Array.isArray(option)
          && typeof (option as Record<string, unknown>).label === 'string'
          ? [{
              label: (option as Record<string, unknown>).label as string,
              ...typeof (option as Record<string, unknown>).description === 'string'
                ? { description: (option as Record<string, unknown>).description as string } : {},
            }] : [])
        : undefined
      if (record.options !== undefined && (!Array.isArray(record.options) || options?.length !== record.options.length)) return []
      questions.push({
        id: record.id, question: record.question,
        ...typeof record.detail === 'string' ? { detail: record.detail } : {},
        ...typeof record.header === 'string' ? { header: record.header } : {},
        ...options === undefined ? {} : { options },
        ...record.multi_select === true ? { multiSelect: true } : {},
      })
    }
    return questions
  } catch {
    return []
  }
}

/** Raw argument JSON of either Tool call shape (running block, or settled result node's call head). */
function readArgsRaw(block: unknown): unknown {
  if (block === null || typeof block !== 'object') return undefined
  const candidate = block as { call?: { argsRaw?: unknown }, argsRaw?: unknown }
  return 'kind' in candidate ? candidate.call?.argsRaw : candidate.argsRaw
}

function useQuestions(sessionId: string | undefined): readonly QuestionEntry[] {
  const revision = useSyncExternalStore(
    listener => questionStore.subscribe(listener),
    () => questionStore.revision,
    () => 0,
  )
  return useMemo(
    () => sessionId === undefined ? [] : questionStore.snapshot(sessionId),
    // `revision` is the store's mutation counter: it republishes every snapshot,
    // so it is the only correctness input besides the identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revision, sessionId],
  )
}

function answerText(entry: QuestionEntry, selected: string[], custom: string): string {
  return [
    `对非阻塞问题「${entry.question.question}」的回答：`,
    JSON.stringify({ questionId: `${entry.callId}:${entry.question.id}`, selected, ...(custom === '' ? {} : { custom }) }),
    '请把它作为后续建议或决策的输入；之前的工作不需要重做。',
  ].join('\n')
}

/** 选项显示独立说明和选中标记，提交保留原始标签。 */
function OptionRow({ index, option, selected, multiSelect, busy, onChoose }: {
  index: number
  option: { label: string, description?: string }
  selected: boolean
  multiSelect: boolean
  busy: boolean
  onChoose: () => void
}) {
  const display = parseRecommendedLabel(option.label)
  return <div className={`${css.option} ${selected ? css.optionSelected : ''}`} onClick={event => {
    if (busy || (event.target as Element).closest('button, a, img, input, textarea, [role="button"]') !== null) return
    onChoose()
  }}>
  <button
    type="button"
    className={css.optionChoice}
    data-dsh-question-option
    data-selected={selected ? 'true' : 'false'}
    role={multiSelect ? 'checkbox' : 'radio'}
    aria-checked={selected}
    aria-label={display.label}
    disabled={busy}
    onClick={onChoose}
  >
    {multiSelect
      ? <span className={`${css.checkbox} ${selected ? css.checkboxChecked : ''}`} aria-hidden="true">
          {selected && <IconCheckOutlineRegular size={12} />}
        </span>
      : <span className={css.number} aria-hidden="true">{selected ? <IconCheckOutlineRegular size={12} /> : index + 1}</span>}
    <span className={css.optionCopy}>
      <span className={css.optionLine}>
        <span className={css.optionLabel}>{display.label}</span>
        {display.recommended && <span className={css.badge}>{COPY.recommended}</span>}
      </span>
    </span>
  </button>
  {option.description !== undefined && <div className={css.description}><QuestionContent text={option.description} /></div>}
  </div>
}

/** 单题编辑区；草稿由会话面板保存，分页与收起不丢失输入。 */
function QuestionCard({ entry, send, index, total, onClose, onNavigate, drafts }: {
  entry: QuestionEntry
  send: Send
  index: number
  total: number
  onClose: () => void
  onNavigate: (index: number) => void
  drafts: Map<string, { selected: string[], custom: string }>
}) {
  const question = entry.question
  const [selected, setSelected] = useState<string[]>(() => drafts.get(entry.key)?.selected ?? [])
  const [custom, setCustom] = useState(() => drafts.get(entry.key)?.custom ?? '')
  useEffect(() => { drafts.set(entry.key, { selected, custom }) }, [drafts, entry.key, selected, custom])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  // The free-form textarea autofocuses on first presentation; re-expanding a
  // collapsed question must not steal focus back into the input, so focus is
  // granted once per card.
  const focused = useRef(false)
  const options = question.options ?? []
  const multiSelect = question.multiSelect === true
  const hasOptions = options.length > 0
  const answered = selected.length > 0 || custom.trim() !== ''
  const locked = busy || submitted
  const last = index === total - 1

  const choose = (label: string): void => {
    if (!multiSelect) setCustom('')
    setSelected(current => multiSelect
      ? current.includes(label) ? current.filter(item => item !== label) : [...current, label]
      : current.includes(label) ? [] : [label])
  }

  const draftCustom = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const value = event.currentTarget.value
    // A multi-select draft retains checked labels, while a single-select custom
    // answer replaces its selection — the blocking card's rule.
    setSelected(current => multiSelect ? current : [])
    setCustom(value)
  }

  const submit = async (): Promise<void> => {
    if (!answered) { setError(COPY.unanswered); return }
    if (locked) return
    setBusy(true); setError('')
    try {
      await send(answerText(entry, selected, custom.trim()))
      // Latch before closing: the send has already been accepted, so a double
      // click must not be able to post the same answer twice.
      setSubmitted(true)
      questionStore.close(entry, 'answered')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '回答未能发送到此对话。')
    } finally {
      setBusy(false)
    }
  }

  const continueFromCustom = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || isComposing(event)) return
    event.preventDefault()
    void submit()
  }

  return <section
    className={css.card}
    data-dsh-question-card
    aria-labelledby={`dsh-question-${entry.key}`}
  >
    <header className={css.header}>
      <div className={css.headingBlock}>
        {question.header !== undefined && <div className={css.eyebrow}>{question.header}</div>}
        <div className={css.title} role="heading" aria-level={2} id={`dsh-question-${entry.key}`}><QuestionContent text={question.question} /></div>
      </div>
      {/* Right corner: the countdown joins the close key on the same icon-button
          grid, so the group's right edge matches the blocking card's. `onClose`
          only closes this local card — it never cancels the queued question on
          the Agent's side. */}
      <div className={css.headerActions}>
        <Countdown askedAt={entry.askedAt} />
        <button
          type="button" className={css.iconButton} aria-label={COPY.close} title={COPY.close}
          disabled={locked} onClick={onClose}
        >
          <IconCloseOutlineRegular />
        </button>
      </div>
    </header>

    <div className={css.body}>
      {question.detail !== undefined && <div className={css.detail}><QuestionContent text={question.detail} /></div>}
      <div className={css.options} role={multiSelect ? 'group' : 'radiogroup'}>
        {options.map((option, optionIndex) => <OptionRow
          key={`${option.label}-${String(optionIndex)}`} index={optionIndex} option={option}
          selected={selected.includes(option.label)} multiSelect={multiSelect} busy={locked}
          onChoose={() => { choose(option.label) }} />)}


        {hasOptions
          ? <div className={`${css.customRow} ${custom !== '' ? css.customRowActive : ''}`}>
              {multiSelect
                ? <span className={`${css.checkbox} ${custom !== '' ? css.checkboxChecked : ''}`} aria-hidden="true">
                    {custom !== '' && <IconCheckOutlineRegular size={12} />}
                  </span>
                : <span className={css.number} aria-hidden="true"><IconEditOutlineRegular size={12} /></span>}
              <AnswerField
                variant="inline" value={custom} disabled={locked} placeholder={COPY.customPlaceholder}
                onChange={draftCustom} onKeyDown={continueFromCustom} />
            </div>
          : <AnswerField
              autoFocus={!focused.current} variant="block" value={custom} disabled={locked}
              placeholder={COPY.customPlaceholder}
              onFocus={() => { focused.current = true }}
              onChange={draftCustom} onKeyDown={continueFromCustom} />}
      </div>
    </div>

    <footer className={css.footer}>
      <div className={css.pager} hidden={total === 1}>
        <button
          type="button" className={css.iconButton} aria-label={COPY.prev}
          disabled={index === 0 || locked} onClick={() => { onNavigate(index - 1) }}
        >
          <IconChevronLeftOutlineRegular />
        </button>
        <span className={css.progress}>{index + 1} / {total}</span>
        <button
          type="button" className={css.iconButton} aria-label={COPY.next}
          disabled={last || locked} onClick={() => { onNavigate(index + 1) }}
        >
          <IconChevronRightOutlineRegular />
        </button>
      </div>
      <div className={css.feedback} role="status">{error}</div>
      <div className={css.footerActions}>
        <Button variant="outline" disabled={locked} onClick={() => { questionStore.close(entry, 'skipped') }}>{COPY.skip}</Button>
        <Button variant="primary" disabled={!answered || locked} onClick={() => { void submit() }}>
          {busy ? '发送中…' : submitted ? '已提交' : '提交'}
        </Button>
      </div>
    </footer>
  </section>
}

/**
 * Questions of one Tool call record themselves locally. The call's own result is
 * already complete when it lands, so the Agent has never waited on the user.
 */
export function QueuedQuestionToolRow({ block, callId, sessionId }: {
  block?: unknown
  callId?: unknown
  sessionId?: unknown
}) {
  const questions = useMemo(() => questionsFrom(block), [block])
  const signature = JSON.stringify(questions)
  useEffect(() => {
    if (typeof sessionId !== 'string' || typeof callId !== 'string' || questions.length === 0) return
    questionStore.enqueue(sessionId, callId, questions)
  }, [sessionId, callId, signature])
  return <div className={css.toolRow}>
    <strong className={css.toolRowTitle}>待回答</strong>
  </div>
}

/**
 * Questions of one Session, kept directly above the composer. The block stays
 * for as long as any question is unanswered: the newest one is open for
 * composing an answer, the older ones collapse into one-line rows.
 */
export function QuestionDock(props: DockProps & Partial<QuestionContentSlots>) {
  return <QuestionContentContext.Provider value={props.renderSlot}><QuestionDockBody {...props} /></QuestionContentContext.Provider>
}

function QuestionDockBody({ sessionId, send }: DockProps) {
  const target = typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined
  const entries = useQuestions(target)
  const drafts = useMemo(() => new Map<string, { selected: string[], custom: string }>(), [target])
  const [openKey, setOpenKey] = useState<string | undefined>(undefined)
  const [collapsed, setCollapsed] = useState(false)
  const answer = send ?? (() => Promise.reject(new Error('原对话尚未加载，无法发送回答。')))
  useEffect(() => {
    if (entries.length === 0) setOpenKey(undefined)
  }, [entries.length])
  // The newest question is the one being asked now; the accent window marks it
  // as fresh, and older unanswered ones stay available further down.
  const newest = entries[entries.length - 1]
  const expandedKey = openKey ?? newest?.key
  if (entries.length === 0) return null
  const older = entries.filter(entry => entry.key !== expandedKey)
  return <section className={css.dock} aria-label="待回答的问题" data-dsh-proactive-questions>
    <button type="button" className={css.dockBar} aria-expanded={!collapsed}
      onClick={() => { setCollapsed(value => !value) }}>

      <span className={css.dockTitle}>需要你的意见</span>
      <span className={css.dockCount}>{entries.length > 1 ? `共 ${entries.length} 个` : ''}</span>
      <span aria-hidden className={css.dockCaret}>{collapsed ? '▲' : '▼'}</span>
    </button>
    {collapsed ? null : <div className={css.dockBody}>
      {expandedKey !== undefined
        ? (() => {
            const entry = entries.find(candidate => candidate.key === expandedKey)
            if (entry === undefined) return null
            return <QuestionCard key={entry.key} entry={entry} send={answer}
              index={entries.findIndex(candidate => candidate.key === entry.key)}
              total={entries.length}
              drafts={drafts}
              onClose={() => { setCollapsed(true) }}
              onNavigate={index => { setOpenKey(entries[index]?.key) }}
              />
          })()
        : null}
      {older.map(entry => <div key={entry.key} className={css.olderRow}>
        <span className={css.olderLabel}>{entry.question.question}</span>
        <button type="button" className={css.linkButton} onClick={() => { setOpenKey(entry.key) }}>回答</button>
        <button type="button" className={css.linkButtonMuted} onClick={() => { questionStore.close(entry, 'skipped') }}>跳过</button>
      </div>)}
      {entries.length > 1
        ? <div className={css.skipAllRow}>
            <button type="button" className={css.skipAll}
              onClick={() => { if (target !== undefined) questionStore.skipAll(target) }}>全部跳过</button>
          </div>
        : null}
    </div>}
  </section>
}
