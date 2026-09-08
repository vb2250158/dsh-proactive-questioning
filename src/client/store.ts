import { ACTIVE_WINDOW_MS, questionVisibility } from './lifecycle.mjs'

export type QuestionOption = { label: string, description?: string }
export type Question = { id: string, question: string, header?: string, options?: QuestionOption[], multiSelect?: boolean }
export type QuestionEntry = {
  key: string
  sessionId: string
  callId: string
  question: Question
  askedAt: number
  state: 'open' | 'answered' | 'skipped'
}

type StoredState = Pick<QuestionEntry, 'askedAt' | 'state'>
type Listener = () => void

const STORAGE_PREFIX = 'dsh-proactive-questioning/v1/'

function keyFor(sessionId: string, callId: string, questionId: string): string {
  return `${callId}:${questionId}`
}

function storageKey(sessionId: string, key: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(sessionId)}/${encodeURIComponent(key)}`
}

function readStored(sessionId: string, key: string): StoredState | undefined {
  try {
    const text = window.localStorage.getItem(storageKey(sessionId, key))
    if (text === null) return undefined
    const value = JSON.parse(text)
    if (typeof value?.askedAt !== 'number' || !['open', 'answered', 'skipped'].includes(value.state)) return undefined
    return { askedAt: value.askedAt, state: value.state }
  } catch {
    return undefined
  }
}

function writeStored(entry: QuestionEntry): void {
  try {
    window.localStorage.setItem(storageKey(entry.sessionId, entry.key), JSON.stringify({ askedAt: entry.askedAt, state: entry.state }))
  } catch {
    // Browser storage can be unavailable. The current page still keeps the question state.
  }
}

/** Browser-local UI state. The durable source remains the tool call in the conversation transcript. */
export class QuestionStore {
  private readonly entries = new Map<string, QuestionEntry>()
  private readonly listeners = new Set<Listener>()
  private readonly snapshots = new Map<string, readonly QuestionEntry[]>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(sessionId: string): readonly QuestionEntry[] {
    const cached = this.snapshots.get(sessionId)
    if (cached !== undefined) return cached
    const next = [...this.entries.values()]
      .filter(entry => entry.sessionId === sessionId && entry.state === 'open')
      .sort((left, right) => left.askedAt - right.askedAt)
    this.snapshots.set(sessionId, next)
    return next
  }

  enqueue(sessionId: string, callId: string, questions: readonly Question[]): void {
    let changed = false
    for (const question of questions) {
      const key = keyFor(sessionId, callId, question.id)
      const previous = this.entries.get(key)
      if (previous !== undefined) continue
      const saved = readStored(sessionId, key)
      const entry: QuestionEntry = {
        key, sessionId, callId, question,
        askedAt: saved?.askedAt ?? Date.now(),
        state: saved?.state ?? 'open',
      }
      this.entries.set(key, entry)
      this.scheduleVisibility(entry)
      changed = true
    }
    if (changed) this.publish()
  }

  close(entry: QuestionEntry, state: 'answered' | 'skipped'): void {
    const current = this.entries.get(entry.key)
    if (current === undefined || current.state !== 'open') return
    const next = { ...current, state }
    this.entries.set(entry.key, next)
    writeStored(next)
    this.clearTimer(entry.key)
    this.publish()
  }

  skipAll(sessionId: string): void {
    let changed = false
    for (const entry of this.entries.values()) {
      if (entry.sessionId !== sessionId || entry.state !== 'open') continue
      const next = { ...entry, state: 'skipped' as const }
      this.entries.set(entry.key, next)
      writeStored(next)
      this.clearTimer(entry.key)
      changed = true
    }
    if (changed) this.publish()
  }

  private scheduleVisibility(entry: QuestionEntry): void {
    if (entry.state !== 'open' || questionVisibility(entry.askedAt) === 'bubble') return
    const delay = Math.max(0, entry.askedAt + ACTIVE_WINDOW_MS - Date.now())
    this.timers.set(entry.key, setTimeout(() => {
      this.timers.delete(entry.key)
      this.publish()
    }, delay))
  }

  private clearTimer(key: string): void {
    const timer = this.timers.get(key)
    if (timer !== undefined) clearTimeout(timer)
    this.timers.delete(key)
  }

  private publish(): void {
    this.snapshots.clear()
    for (const listener of this.listeners) listener()
  }
}

export const questionStore = new QuestionStore()
