import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { Question, QuestionEntry } from './store.ts'
import { questionStore } from './store.ts'
import { questionVisibility } from './lifecycle.mjs'

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

function Chip({ label, selected, disabled, onClick }: {
  label: string
  selected: boolean
  disabled: boolean
  onClick: () => void
}) {
  return <button type="button" role="radio" aria-checked={selected} disabled={disabled} onClick={onClick}
    style={{
      border: `1px solid ${selected ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l2)'}`,
      borderRadius: 999, padding: '5px 11px', fontSize: 13, lineHeight: '18px',
      background: selected ? 'var(--dsw-alias-interactive-bg-hover)' : 'var(--dsw-alias-bg-base)',
      color: 'var(--dsw-alias-label-primary)', cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? .6 : 1,
    }}>{label}</button>
}

function Action({ label, primary, disabled, onClick }: {
  label: string
  primary: boolean
  disabled: boolean
  onClick: () => void
}) {
  return <button type="button" disabled={disabled} onClick={onClick}
    style={{
      border: primary ? '1px solid transparent' : '0.5px solid var(--dsw-alias-border-l3)',
      borderRadius: 999, padding: '5px 12px', fontSize: 12, lineHeight: '18px',
      background: primary ? 'var(--dsw-alias-button-primary-fill)' : 'transparent',
      color: primary ? 'var(--dsw-alias-label-primary-foreground)' : 'var(--dsw-alias-label-secondary)',
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .5 : 1,
    }}>{label}</button>
}

function QuestionCard({ entry, send, expanded }: { entry: QuestionEntry, send: Send, expanded: boolean }) {
  const [selected, setSelected] = useState<string[]>([])
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const options = entry.question.options ?? []
  const canSubmit = selected.length > 0 || custom.trim() !== ''
  const choose = (label: string) => {
    setSelected(previous => entry.question.multiSelect
      ? previous.includes(label) ? previous.filter(value => value !== label) : [...previous, label]
      : previous.includes(label) ? [] : [label])
  }
  const submit = async () => {
    if (!canSubmit || busy) return
    setBusy(true); setError('')
    try {
      await send(answerText(entry, selected, custom.trim()))
      questionStore.close(entry, 'answered')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '回答未能发送到此对话。')
    } finally {
      setBusy(false)
    }
  }
  return <div role="group" aria-label={entry.question.question}
    style={{ marginTop: 10, ...expanded ? {} : { borderTop: '0.5px solid var(--dsw-alias-border-l1)', paddingTop: 10 } }}>
    {expanded && entry.question.header
      ? <div style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, marginBottom: 4 }}>{entry.question.header}</div>
      : null}
    <div style={{ fontSize: 13, lineHeight: '20px', whiteSpace: 'pre-wrap' }}>{entry.question.question}</div>
    {options.length === 0 ? null : <div role={entry.question.multiSelect ? 'group' : 'radiogroup'}
      aria-label={entry.question.multiSelect ? '可多选' : '单选'} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
      {options.map(option => <Chip key={option.label} label={option.label} disabled={busy}
        selected={selected.includes(option.label)} onClick={() => { choose(option.label) }} />)}
    </div>}
    {expanded ? <textarea aria-label="补充回答" value={custom} disabled={busy}
      onChange={event => setCustom(event.currentTarget.value)}
      placeholder="也可以不选选项，直接写想法"
      style={{
        boxSizing: 'border-box', width: '100%', minHeight: 56, marginTop: 8, padding: '7px 9px',
        fontSize: 13, lineHeight: '20px', resize: 'vertical', outline: 'none',
        color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-base)',
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8,
      }} /> : null}
    {error ? <p role="alert" style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--dsw-alias-state-error-primary)' }}>{error}</p> : null}
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
      <Action label={busy ? '发送中…' : '提交回答'} primary disabled={!canSubmit || busy} onClick={() => { void submit() }} />
      <Action label="跳过" primary={false} disabled={busy} onClick={() => { questionStore.close(entry, 'skipped') }} />
      {!custom.trim() && options.length > 0 && !expanded
        ? <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>也可以直接写下想法</span>
        : null}
    </div>
  </div>
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
  return <section style={PANEL} aria-label="待答的非阻塞问题">
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
        {entries.length > 1 ? `共 ${entries.length} 个 · ` : ''}它不会等你
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
