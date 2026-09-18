import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  Button, IconCheckOutline14, IconChevronLeftOutline14,
  IconChevronRightOutline14, IconCloseOutline16, IconEditOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Question, QuestionEntry } from './store.ts'
import { questionStore } from './store.ts'
import { questionRemainingSeconds, questionVisibility } from './lifecycle.mjs'

type Send = (text: string) => Promise<unknown>

/**
 * One dock occurrence's runtime props.
 *
 * `sessionId` is the framework's own Session standard prop (`ui-session`
 * merges `sessionId`/`useSession`/`useProjection` into every session-scope
 * slot), so it is not something this plugin injects. `send` is the one
 * injected verb; see `index.ts` for how it is built.
 */
type DockProps = {
  sessionId?: unknown
  send?: Send
}

const PANEL = {
  border: '0.5px solid var(--dsw-alias-border-l1)',
  borderRadius: 12,
  background: 'var(--dsw-specific-tip)',
  color: 'var(--dsw-alias-label-primary)',
} as const

/**
 * The blocking card's presentation, restated through the same theme tokens.
 *
 * Deliberately mirrors `ui-user-questions`' `QuestionComposer.module.css` —
 * card surface, 20px radius, 24/16px header insets, 20×20 numbered indicator,
 * and the bordered footer buttons — so a queued question reads as the same
 * component family as the blocking one. It is restated rather than imported
 * because that stylesheet is package-internal (`css` module scope, not a
 * published export), and this plugin ships its own bundle.
 */
const CARD: Record<string, string | number> = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  padding: '0 0 10px',
  border: '0.5px solid var(--dsw-alias-border-l2-darkmode-thin)',
  borderRadius: 20,
  background: 'var(--dsw-specific-input-major)',
  boxShadow: 'var(--dsw-elevation-panel)',
  color: 'var(--dsw-alias-label-primary)',
  overflow: 'hidden',
}

const HEADER: Record<string, string | number> = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 16,
  padding: '20px 16px 0 24px',
}

const ICON_BUTTON: Record<string, string | number> = {
  display: 'grid',
  placeItems: 'center',
  width: 24,
  height: 24,
  padding: 0,
  border: 'none',
  borderRadius: 999,
  background: 'transparent',
  color: 'var(--dsw-alias-label-tertiary)',
  cursor: 'pointer',
}

const OPTION_ROW: Record<string, string | number> = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  width: '100%',
  minHeight: 40,
  flexShrink: 0,
  padding: '8px 12px 8px 8px',
  border: '1px solid transparent',
  borderRadius: 12,
  background: 'transparent',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
}

/** Leading indicator seat: 20×20, radius 6, offset to center on the first line box. */
const INDICATOR: Record<string, string | number> = {
  display: 'grid',
  placeItems: 'center',
  flex: '0 0 20px',
  width: 20,
  height: 20,
  marginTop: 2,
  borderRadius: 6,
  background: 'var(--dsw-alias-bg-overlay)',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  fontWeight: 500,
  lineHeight: '18px',
}

const FOOTER: Record<string, string | number> = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  marginTop: 12,
  padding: '0 10px 0 18px',
}

/** Pager / countdown read-out: the blocking card's `.progress` type ramp. */
const READOUT: Record<string, string | number> = {
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 14,
  lineHeight: '24px',
  fontWeight: 500,
  whiteSpace: 'nowrap',
}

/**
 * Split the conventional recommendation suffix off an option label.
 *
 * Same rule as the blocking card's `parseRecommendedLabel`, so a question
 * authored for either surface marks its recommended option identically. The
 * suffix is presentation only: selecting the option still sends the ORIGINAL
 * label, which is what keeps the answer meaningful to the Agent that asked.
 * @param label - the option label as authored.
 * @returns the display label plus whether it carried a recommendation marker.
 */
function parseRecommendedLabel(label: string): { label: string, recommended: boolean } {
  const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i
  return suffix.test(label)
    ? { label: label.replace(suffix, ''), recommended: true }
    : { label, recommended: false }
}

/**
 * The fresh-period read-out for one card.
 *
 * Renders the remaining seconds while the accent window is open and a neutral
 * marker afterwards. Both branches are informational: the window closing is
 * NOT an expiry, nothing is hidden or settled here, and reaching the end must
 * leave the card exactly as usable as it was one second earlier.
 * @param askedAt - when the question was enqueued.
 * @returns the countdown node.
 */
function Countdown({ askedAt }: { askedAt: number }) {
  const remaining = questionRemainingSeconds(askedAt)
  useEffect(() => { if (remaining === undefined) questionStore.skipAll() }, [remaining])
  return <span
    data-dsh-question-countdown
    data-state={remaining === undefined ? 'settled' : 'counting'}
    title="新鲜期剩余时间。到期后问题仍然保留，不会自动关闭。"
    aria-label={remaining === undefined ? '新鲜期已过，问题仍然保留' : `新鲜期还剩 ${String(remaining)} 秒`}
    style={{ ...READOUT, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}
  >
    {remaining === undefined ? '已保留' : `${String(remaining)}s`}
  </span>
}

/**
 * Questions of one call.
 *
 * A Tool call reaches this view in two shapes: while it runs the arguments
 * still live on the block itself, and once it settles the block becomes a
 * result node whose `call` head carries them. Reading both is what lets the
 * question appear the moment the Agent asks it instead of after the tool
 * returns — a question shown only afterwards is one the user has usually
 * already scrolled past.
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
      if (record.options !== undefined && options?.length !== record.options.length) return []
      questions.push({
        id: record.id, question: record.question,
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
    // `revision` is the store's mutation counter: it republishes every
    // snapshot, so it is the only correctness input besides the identity.
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

/**
 * One option row, shaped like the blocking card's.
 *
 * Single-select shows its ordinal in the indicator seat, multi-select swaps in
 * a checkbox that mirrors the selection. A preferred option carries the same
 * "推荐" tag the blocking surface uses, parsed off the label so a question
 * written once reads the same on either surface.
 */
function OptionRow({ index, label, description, selected, multiSelect, busy, onChoose }: {
  index: number
  label: string
  description?: string
  selected: boolean
  multiSelect: boolean
  busy: boolean
  onChoose: () => void
}) {
  const display = parseRecommendedLabel(label)
  return <button
    type="button"
    data-dsh-question-option
    data-selected={selected ? 'true' : 'false'}
    role={multiSelect ? 'checkbox' : 'radio'}
    aria-checked={selected}
    aria-label={display.label}
    disabled={busy}
    onClick={onChoose}
    style={{
      ...OPTION_ROW,
      // Single-select keeps the selected row visibly committed; multi-select
      // reuses the same surface so both read as one control family.
      ...selected ? { background: 'var(--dsw-alias-interactive-bg-hover)', borderColor: 'var(--dsw-alias-border-l2)' } : {},
      cursor: busy ? 'default' : 'pointer',
    }}
  >
    {multiSelect
      ? <CheckBox checked={selected} />
      : <span aria-hidden style={INDICATOR}>{index + 1}</span>}
    <span style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '2px 6px' }}>
      <span style={{ fontSize: 14, lineHeight: '24px', fontWeight: 500 }}>{display.label}</span>
      {display.recommended
        ? <span style={{
            padding: '0 4px', borderRadius: 6, fontSize: 11, lineHeight: '18px', fontWeight: 600,
            background: 'var(--dsw-specific-sidebar-nav-item-active-accent)',
            color: 'var(--dsw-alias-button-info-fill)',
          }}>推荐</span>
        : null}
      {description === undefined
        ? null
        : <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 14, lineHeight: '24px' }}>{description}</span>}
    </span>
  </button>
}

/** Multi-select marker: a 14×14 box drawn as a layer so the check stacks over it. */
function CheckBox({ checked }: { checked: boolean }) {
  return <span aria-hidden style={{ display: 'grid', placeItems: 'center', flex: '0 0 20px', width: 20, height: 20, marginTop: 2 }}>
    <span style={{
      gridArea: '1 / 1', width: 14, height: 14, borderRadius: 4,
      border: `0.5px solid ${checked ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-border-l4)'}`,
      background: checked ? 'var(--dsw-alias-label-primary)' : 'transparent',
    }} />
    {checked
      ? <span style={{ gridArea: '1 / 1', display: 'grid', placeItems: 'center', color: 'var(--dsw-alias-label-primary-foreground)' }}>
          <IconCheckOutline14 size={12} />
        </span>
      : null}
  </span>
}

function QuestionCard({ entry, send, expanded, index, total, onClose }: {
  entry: QuestionEntry
  send: Send
  expanded: boolean
  index: number
  total: number
  onClose: () => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const options = entry.question.options ?? []
  const multiSelect = entry.question.multiSelect === true
  const canSubmit = selected.length > 0 || custom.trim() !== ''
  const locked = busy || submitted
  const choose = (label: string) => {
    setSelected(previous => multiSelect
      ? previous.includes(label) ? previous.filter(value => value !== label) : [...previous, label]
      : previous.includes(label) ? [] : [label])
  }
  const submit = async () => {
    if (!canSubmit || locked) return
    setBusy(true); setError('')
    try {
      await send(answerText(entry, selected, custom.trim()))
      // Latch before closing: the send has already been accepted, so a
      // double click must not be able to post the same answer twice.
      setSubmitted(true)
      questionStore.close(entry, 'answered')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '回答未能发送到此对话。')
    } finally {
      setBusy(false)
    }
  }
  // The collapsed variant keeps its one-line row and drops the card chrome:
  // only the newest question is worth a full card, older ones must stay cheap.
  if (!expanded) {
    return <div role="group" aria-label={entry.question.question}
      style={{ marginTop: 10, borderTop: '0.5px solid var(--dsw-alias-border-l1)', paddingTop: 10 }}>
      <div style={{ fontSize: 13, lineHeight: '20px', whiteSpace: 'pre-wrap' }}>{entry.question.question}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {options.map((option, optionIndex) => <OptionRow
          key={option.label} index={optionIndex} label={option.label} description={option.description}
          selected={selected.includes(option.label)} multiSelect={multiSelect} busy={locked}
          onChoose={() => { choose(option.label) }} />)}
      </div>
      <div style={{ marginTop: 8 }}>
        <textarea aria-label="补充回答" value={custom} disabled={locked}
          onChange={event => { setCustom(event.currentTarget.value) }}
          placeholder="也可以不选选项，直接写想法"
          style={{
            boxSizing: 'border-box', width: '100%', minHeight: 56, padding: '7px 9px',
            fontSize: 13, lineHeight: '20px', resize: 'vertical', outline: 'none',
            color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-base)',
            border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8,
          }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
        <Button variant="outline" disabled={locked} onClick={() => { questionStore.close(entry, 'skipped') }}>跳过本题</Button>
        <Button variant="primary" disabled={!canSubmit || locked} onClick={() => { void submit() }}>
          {busy ? '发送中…' : submitted ? '已提交' : '提交'}
        </Button>
      </div>
      {error ? <p role="alert" style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--dsw-alias-state-error-primary)' }}>{error}</p> : null}
    </div>
  }
  return <section
    data-dsh-question-card
    aria-labelledby={`dsh-question-${entry.key}`}
    style={{ ...CARD, marginTop: 10 }}
  >
    <header style={HEADER}>
      <div style={{ minWidth: 0 }}>
        {entry.question.header === undefined
          ? null
          : <div style={{ marginBottom: 5, color: 'var(--dsw-alias-label-tertiary)', fontSize: 11, lineHeight: '16px' }}>
              {entry.question.header}
            </div>}
        <h2 id={`dsh-question-${entry.key}`} style={{ margin: 0, fontSize: 16, lineHeight: '22px', fontWeight: 500 }}>
          {entry.question.question}
        </h2>
      </div>
      {/* Right corner: the countdown sits beside the dismiss key, matching the
          blocking card's header action group. `onClose` only closes this local
          card — it never cancels the queued question on the Agent's side. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <Countdown askedAt={entry.askedAt} />
        <button
          type="button" style={ICON_BUTTON} disabled={locked}
          aria-label="收起草稿（问题仍保留，可随时回来回答）"
          title="收起草稿（问题仍保留，可随时回来回答）"
          onClick={onClose}
        >
          <IconCloseOutline16 />
        </button>
      </div>
    </header>

    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, margin: '8px 0 0', padding: '4px 12px' }}>
      {options.length === 0 ? null : <div role={multiSelect ? 'group' : 'radiogroup'}
        aria-label={multiSelect ? '可多选' : '单选'}>
        {options.map((option, optionIndex) => <OptionRow
          key={option.label} index={optionIndex} label={option.label} description={option.description}
          selected={selected.includes(option.label)} multiSelect={multiSelect} busy={locked}
          onChoose={() => { choose(option.label) }} />)}
      </div>}
      {/* The free-text answer keeps the blocking card's inline row shape: an
          option-shaped row whose copy is the field, lifted while it holds text. */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%', minHeight: 40, flexShrink: 0,
        padding: '8px 12px 8px 8px', border: `1px solid ${custom === '' ? 'transparent' : 'var(--dsw-alias-border-l2)'}`,
        borderRadius: 12, background: custom === '' ? 'transparent' : 'var(--dsw-alias-interactive-bg-hover)',
      }}>
        {multiSelect
          ? <CheckBox checked={custom !== ''} />
          : <span aria-hidden style={INDICATOR}><IconEditOutline16 size={12} /></span>}
        <textarea aria-label="补充回答" value={custom} disabled={locked}
          onChange={event => { setCustom(event.currentTarget.value) }}
          placeholder="也可以不选选项，直接写想法"
          style={{
            flex: 1, minWidth: 0, minHeight: 32, padding: 0, border: 'none', outline: 'none',
            background: 'transparent', resize: 'vertical',
            font: 'inherit', fontSize: 14, lineHeight: '24px',
            color: 'var(--dsw-alias-label-primary)', caretColor: 'var(--dsw-alias-state-business-primary)',
          }} />
      </div>
    </div>

    <footer style={FOOTER}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <button type="button" style={{ ...ICON_BUTTON, color: 'var(--dsw-alias-label-dimmed)', cursor: 'default' }}
          disabled aria-label="上一题（非阻塞问题逐条列出，无需翻页）">
          <IconChevronLeftOutline14 />
        </button>
        <span style={{ ...READOUT, padding: '0 4px', wordSpacing: -2 }}>{index + 1} / {total}</span>
        <button type="button" style={{ ...ICON_BUTTON, color: 'var(--dsw-alias-label-dimmed)', cursor: 'default' }}
          disabled aria-label="下一题（非阻塞问题逐条列出，无需翻页）">
          <IconChevronRightOutline14 />
        </button>
      </div>
      <div role="status" style={{
        flex: 1, minHeight: 16, color: 'var(--dsw-alias-state-error-primary)',
        fontSize: 11, lineHeight: '16px', textAlign: 'right',
      }}>{error}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <Button variant="outline" disabled={locked} onClick={() => { questionStore.close(entry, 'skipped') }}>跳过本题</Button>
        <Button variant="primary" disabled={!canSubmit || locked} onClick={() => { void submit() }}>
          {busy ? '发送中…' : submitted ? '已提交' : '提交'}
        </Button>
      </div>
    </footer>
  </section>
}

/**
 * Questions of one Tool call record themselves locally. The call's own result
 * is already complete when it lands, so the Agent has never waited on the user.
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
  return <div style={{ ...PANEL, padding: 12, background: 'var(--dsw-alias-bg-layer-1)' }}>
    <strong style={{ fontSize: 13 }}>已加入非阻塞问题</strong>
    <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)' }}>
      Agent 已继续处理，不会等你的回答。问题会留在输入框上方，直到你回答或跳过。
    </p>
  </div>
}

/**
 * Questions of one Session, kept directly above the composer. The block
 * stays for as long as any question is unanswered: the newest one is open
 * for composing an answer, the older ones collapse into one-line rows.
 */
export function QuestionDock({ sessionId, send }: DockProps) {
  const target = typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined
  const entries = useQuestions(target)
  const [openKey, setOpenKey] = useState<string | undefined>(undefined)
  const [collapsed, setCollapsed] = useState(false)
  const answer = send ?? (() => Promise.reject(new Error('原对话尚未加载，无法发送回答。')))
  useEffect(() => {
    if (entries.length === 0) setOpenKey(undefined)
  }, [entries.length])
  // The newest question is the one being asked now; the accent window marks
  // it as fresh, and older unanswered ones stay available further down.
  const newest = entries[entries.length - 1]
  const expandedKey = openKey ?? newest?.key
  if (entries.length === 0) return null
  const older = entries.filter(entry => entry.key !== expandedKey)
  return <section style={PANEL} aria-label="待答的非阻塞问题" data-dsh-proactive-questions>
    <button type="button" aria-expanded={!collapsed} onClick={() => { setCollapsed(value => !value) }}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '6px 12px',
        border: 'none', borderRadius: 12, background: 'transparent', color: 'inherit',
        textAlign: 'left', cursor: 'pointer',
      }}>
      <span aria-hidden style={{ display: 'grid', placeItems: 'center', color: 'var(--dsw-alias-label-tertiary)' }}>💬</span>
      <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 13, fontWeight: 500, lineHeight: '20px' }}>
        Agent 想听听你的想法
      </span>
      <span style={{ flex: 'none', color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>
        {entries.length > 1 ? `共 ${entries.length} 个` : ''}
      </span>
      <span aria-hidden style={{ flex: 'none', color: 'var(--dsw-alias-label-tertiary)', fontSize: 10 }}>
        {collapsed ? '▲' : '▼'}
      </span>
    </button>
    {collapsed ? null : <div style={{ padding: '0 12px 12px' }}>
      {expandedKey !== undefined
        ? (() => {
            const entry = entries.find(candidate => candidate.key === expandedKey)
            if (entry === undefined) return null
            return <QuestionCard key={entry.key} entry={entry} send={answer}
              index={entries.findIndex(candidate => candidate.key === entry.key)}
              total={entries.length}
              onClose={() => { setOpenKey(entries.find(candidate => candidate.key !== entry.key)?.key ?? entry.key) }}
              expanded={questionVisibility(entry.askedAt) === 'active' || openKey === entry.key} />
          })()
        : null}
      {older.map(entry => <div key={entry.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, borderTop: '0.5px solid var(--dsw-alias-border-l1)', paddingTop: 10 }}>
        <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, color: 'var(--dsw-alias-label-secondary)' }}>
          {entry.question.question}
        </span>
        <button type="button" style={{ flex: 'none', border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-primary)', fontSize: 13, cursor: 'pointer', padding: 0 }}
          onClick={() => { setOpenKey(entry.key) }}>回答</button>
        <button type="button" style={{ flex: 'none', border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, cursor: 'pointer', padding: 0 }}
          onClick={() => { questionStore.close(entry, 'skipped') }}>跳过</button>
      </div>)}
      {entries.length > 1
        ? <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" style={{ border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, cursor: 'pointer', padding: 0 }}
              onClick={() => { if (target !== undefined) questionStore.skipAll(target) }}>全部跳过</button>
          </div>
        : null}
    </div>}
  </section>
}
