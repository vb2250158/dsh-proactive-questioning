import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Question, QuestionEntry } from './store.ts'
import { questionStore } from './store.ts'
import { questionVisibility } from './lifecycle.mjs'

type ToolProps = { block?: unknown, callId?: unknown, sessionId?: unknown }
type Send = (text: string) => Promise<unknown>

const panelStyle = {
  padding: 12, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 10,
  background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
} as const
const buttonStyle = {
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 7, padding: '6px 10px',
  background: 'var(--dsw-alias-bg-base)', color: 'inherit', cursor: 'pointer',
} as const

function questionsFrom(block: unknown): Question[] {
  const raw = (block as { call?: { argsRaw?: unknown } } | undefined)?.call?.argsRaw
  if (typeof raw !== 'string') return []
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

function useQuestions(sessionId: string): readonly QuestionEntry[] {
  return useSyncExternalStore(
    listener => questionStore.subscribe(listener),
    () => questionStore.snapshot(sessionId),
    () => [],
  )
}

function answerText(entry: QuestionEntry, selected: string[], custom: string): string {
  return [
    `对非阻塞问题「${entry.question.question}」的回答：`,
    JSON.stringify({ questionId: `${entry.callId}:${entry.question.id}`, selected, ...(custom === '' ? {} : { custom }) }),
    '请把它作为后续建议或决策的输入；之前的工作不需要重做。',
  ].join('\n')
}

function QuestionCard({ entry, send }: { entry: QuestionEntry, send: Send }) {
  const [selected, setSelected] = useState<string[]>([])
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const canSubmit = selected.length > 0 || custom.trim() !== ''
  const choose = (label: string, checked: boolean) => {
    setSelected(previous => entry.question.multiSelect
      ? checked ? [...previous, label] : previous.filter(value => value !== label)
      : checked ? [label] : [])
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
  return <section style={{ ...panelStyle, marginTop: 8 }} aria-label="非阻塞问题">
    {entry.question.header ? <div style={{ opacity: .72, fontSize: 12 }}>{entry.question.header}</div> : null}
    <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{entry.question.question}</div>
    {(entry.question.options ?? []).map(option => <label key={option.label} style={{ display: 'flex', gap: 7, marginTop: 8, alignItems: 'flex-start' }}>
      <input type={entry.question.multiSelect ? 'checkbox' : 'radio'} name={entry.key}
        checked={selected.includes(option.label)} disabled={busy}
        onChange={event => choose(option.label, event.currentTarget.checked)} />
      <span>{option.label}{option.description ? <small style={{ display: 'block', opacity: .72 }}>{option.description}</small> : null}</span>
    </label>)}
    <textarea aria-label="补充回答" value={custom} disabled={busy} onChange={event => setCustom(event.currentTarget.value)}
      placeholder="也可以不选选项，直接写想法" style={{ boxSizing: 'border-box', width: '100%', minHeight: 56, marginTop: 8, padding: 7, color: 'inherit', background: 'var(--dsw-alias-bg-base)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6 }} />
    {error ? <p role="alert" style={{ margin: '8px 0 0' }}>{error}</p> : null}
    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
      <button style={buttonStyle} disabled={!canSubmit || busy} onClick={() => { void submit() }}>{busy ? '发送中…' : '提交回答'}</button>
      <button style={buttonStyle} disabled={busy} onClick={() => questionStore.close(entry, 'skipped')}>跳过</button>
    </div>
  </section>
}

/** Tool-call row only records the question locally. Its server result is already complete, so the agent keeps reasoning. */
export function QueuedQuestionToolRow({ block, callId, sessionId }: ToolProps) {
  const questions = questionsFrom(block)
  useEffect(() => {
    if (typeof sessionId !== 'string' || typeof callId !== 'string' || questions.length === 0) return
    questionStore.enqueue(sessionId, callId, questions)
  }, [sessionId, callId, JSON.stringify(questions)])
  return <div style={panelStyle}>
    <strong>已加入非阻塞问题</strong>
    <p style={{ margin: '6px 0 0' }}>Agent 已继续处理；问题会先显示 30 秒，之后进入输入框旁的气泡。回答、跳过或关闭都不会回写这次工具调用。</p>
  </div>
}

export function QuestionDock({ sessionId, send }: { sessionId: string, send: Send }) {
  const entries = useQuestions(sessionId)
  const active = entries.filter(entry => questionVisibility(entry.askedAt) === 'active')
  if (active.length === 0) return null
  return <section style={{ ...panelStyle, margin: '0 auto 10px', maxWidth: 760 }} aria-label="刚提出的非阻塞问题">
    <strong>Agent 想听听你的想法</strong>
    <span style={{ marginLeft: 8, opacity: .72, fontSize: 12 }}>它不会等你的回答，30 秒后会收进气泡</span>
    {active.map(entry => <QuestionCard key={entry.key} entry={entry} send={send} />)}
  </section>
}

export function QuestionBubble({ sessionId, send }: { sessionId: string, send: Send }) {
  const entries = useQuestions(sessionId)
  const pending = entries.filter(entry => questionVisibility(entry.askedAt) === 'bubble')
  const [open, setOpen] = useState(false)
  useEffect(() => { if (pending.length === 0) setOpen(false) }, [pending.length])
  if (pending.length === 0) return null
  return <div style={{ position: 'relative' }}>
    <button style={{ ...buttonStyle, borderRadius: 999, padding: '5px 9px' }} aria-label={`打开 ${pending.length} 个待答问题`}
      onClick={() => setOpen(value => !value)}>💬 {pending.length}</button>
    {open ? <section style={{ ...panelStyle, position: 'absolute', zIndex: 12, width: 340, maxHeight: 440, overflowY: 'auto', left: 0, bottom: 'calc(100% + 8px)' }} aria-label="待答问题列表">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong>待答问题</strong>
        <button style={buttonStyle} onClick={() => questionStore.skipAll(sessionId)}>全部跳过</button>
      </div>
      {pending.map(entry => <QuestionCard key={entry.key} entry={entry} send={send} />)}
    </section> : null}
  </div>
}
