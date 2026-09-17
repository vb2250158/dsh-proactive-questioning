import { ACTIVE_WINDOW_MS } from './lifecycle.mjs'

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
  return `${sessionId}:${callId}:${questionId}`
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
  /** Bumped by every mutation; the render subscription's getSnapshot value. */
  private version = 0

  /** Monotonic mutation counter — a valid `useSyncExternalStore` snapshot. */
  get revision(): number {
    return this.version
  }

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

  /**
   * Resolve the session that has been waiting longest on an answer.
   *
   * Ties break on the entry key: two questions enqueued in the same
   * millisecond (one Agent step asking twice) would otherwise resolve in
   * insertion order, which depends on tool-call order rather than on anything
   * the user can see. Ordering by key keeps the choice stable across renders.
   */
  sessionWithOpenQuestion(): string | undefined {
    let oldest: { sessionId: string, askedAt: number, key: string } | undefined
    for (const entry of this.entries.values()) {
      if (entry.state !== 'open') continue
      if (oldest === undefined
        || entry.askedAt < oldest.askedAt
        || (entry.askedAt === oldest.askedAt && entry.key < oldest.key)) {
        oldest = { sessionId: entry.sessionId, askedAt: entry.askedAt, key: entry.key }
      }
    }
    return oldest?.sessionId
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
      // Persist on sight, not only on close: `askedAt` is what the accent
      // window is measured from, so a reload must not restart the clock and
      // make an old question re-announce itself as new.
      writeStored(entry)
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
    this.prune(entry.sessionId)
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
    if (changed) {
      this.prune(sessionId)
      this.publish()
    }
  }

  /**
   * Drop the records of one Session once nothing is left open there. The
   * durable transcript already owns the question text, and the browser only
   * mirrors "shown / answered / skipped", so a settled Session keeps no
   * entries — which is what stops the id-keyed ledger from growing for the
   * lifetime of the page.
   */
  private prune(sessionId: string): void {
    let removed = false
    for (const [key, entry] of this.entries) {
      if (entry.sessionId === sessionId && entry.state !== 'open') {
        this.entries.delete(key)
        removed = true
      }
    }
    if (removed) this.snapshots.delete(sessionId)
  }

  /**
   * One timer marks the end of the newest-question accent window.
   *
   * It is deliberately `unref`'d where the host offers it: the timer exists
   * only to repaint an accent, so it must never be the reason a browser-less
   * host (a test process, a headless preview) stays alive after its work is
   * done.
   */
  private scheduleVisibility(entry: QuestionEntry): void {
    if (entry.state !== 'open') return
    const delay = Math.max(0, entry.askedAt + ACTIVE_WINDOW_MS - Date.now())
    const timer = setTimeout(() => {
      this.timers.delete(entry.key)
      this.publish()
    }, delay)
    const unref = (timer as unknown as { unref?: () => void }).unref
    if (typeof unref === 'function') unref.call(timer)
    this.timers.set(entry.key, timer)
  }

  private clearTimer(key: string): void {
    const timer = this.timers.get(key)
    if (timer !== undefined) clearTimeout(timer)
    this.timers.delete(key)
  }

  /** Drop every pending accent timer. Used by tests and page teardown. */
  dispose(): void {
    for (const key of [...this.timers.keys()]) this.clearTimer(key)
    this.listeners.clear()
  }

  private publish(): void {
    this.version += 1
    this.snapshots.clear()
    for (const listener of this.listeners) listener()
  }
}

export const questionStore = new QuestionStore()
