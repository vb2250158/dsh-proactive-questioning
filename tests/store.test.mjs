import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * The store keeps browser-local UI state and is the only place that can leak
 * across a long-lived page, so it is unit-tested directly. `window` is stubbed
 * because Node has no localStorage. Each test uses its own session id: the
 * store persists `askedAt`/`state` per `sessionId + callId + questionId`, so
 * reusing an id across tests would inherit the previous test's settled state.
 */
const storage = new Map()
globalThis.window = {
  localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value) },
  },
}

const { QuestionStore } = await import('../src/client/store.ts')

const question = id => ({ id, question: `问题 ${id}` })

/** Every store in this file is disposed so no accent timer outlives its test. */
const stores = []
function freshStore() {
  const store = new QuestionStore()
  stores.push(store)
  return store
}
test.after(() => {
  for (const store of stores) store.dispose()
})

/**
 * Seed one question's saved clock before it is enqueued.
 *
 * `askedAt` is what "oldest" is measured from, and the wall clock only has
 * millisecond resolution, so a test that needs a definite ordering must set
 * the clock rather than hope two enqueues straddle a tick. `enqueue` adopts
 * the saved `askedAt` for a key it has not seen, so writing storage first is
 * the supported way to say "this one was asked earlier".
 * @param sessionId - the Session the question belongs to.
 * @param callId - the Tool call the question belongs to.
 * @param questionId - the question's own id.
 * @param askedAt - the timestamp to record.
 * @returns the question its own arrival is seeded for.
 */
function seedAskedAt(sessionId, callId, questionId, askedAt) {
  storage.set(
    `dsh-proactive-questioning/v1/${encodeURIComponent(sessionId)}/${encodeURIComponent(`${sessionId}:${callId}:${questionId}`)}`,
    JSON.stringify({ askedAt, state: 'open' }),
  )
  return { id: questionId, question: `问题 ${questionId}` }
}

test('keeps every unanswered question visible for its session', () => {
  const store = freshStore()
  store.enqueue('t1', 'call-a', [question('q1'), question('q2')])
  store.enqueue('t1b', 'call-b', [question('q3')])
  assert.deepEqual(store.snapshot('t1').map(entry => entry.key), ['t1:call-a:q1', 't1:call-a:q2'])
  assert.deepEqual(store.snapshot('t1b').map(entry => entry.key), ['t1b:call-b:q3'])
  assert.deepEqual(store.snapshot('t1c'), [])
})

test('an unanswered question never expires on its own', () => {
  const store = freshStore()
  store.enqueue('t2', 'call-a', [question('q1')])
  // The store schedules no auto-close; only an explicit close settles a row.
  assert.equal(store.snapshot('t2').length, 1)
  assert.equal(store.snapshot('t2')[0].state, 'open')
})

test('drops a session ledger once all its questions are settled', () => {
  const store = freshStore()
  store.enqueue('t3', 'call-a', [question('q1'), question('q2')])
  store.close(store.snapshot('t3')[0], 'answered')
  assert.deepEqual(store.snapshot('t3').map(entry => entry.key), ['t3:call-a:q2'])
  store.close(store.snapshot('t3')[0], 'skipped')
  // Nothing open left in t3: its ledger must not grow for the page lifetime.
  assert.deepEqual(store.snapshot('t3'), [])
  assert.equal(store.sessionWithOpenQuestion(), undefined)
})

test('reports the oldest session still waiting on an answer', () => {
  const store = freshStore()
  // Order comes from the recorded clock, not from insertion order: the two
  // enqueues can land in one millisecond, and the later asker must not win
  // just because the store happened to see it first.
  const later = seedAskedAt('t5-later', 'call-b', 'q2', Date.now())
  const earlier = seedAskedAt('t4-earlier', 'call-a', 'q1', Date.now() - 60 * 60_000)
  store.enqueue('t5-later', 'call-b', [later])
  store.enqueue('t4-earlier', 'call-a', [earlier])
  assert.equal(store.sessionWithOpenQuestion(), 't4-earlier')
  store.skipAll('t4-earlier')
  assert.equal(store.sessionWithOpenQuestion(), 't5-later')
  store.skipAll('t5-later')
  assert.equal(store.sessionWithOpenQuestion(), undefined)
})

test('a question id already enqueued in one call is not duplicated', () => {
  const store = freshStore()
  store.enqueue('t6', 'call-a', [question('q1')])
  store.enqueue('t6', 'call-a', [question('q1')])
  assert.equal(store.snapshot('t6').length, 1)
})

test('republishes once the accent window closes, without settling the question', async () => {
  const store = freshStore()
  let published = 0
  store.subscribe(() => { published += 1 })
  store.enqueue('t8', 'call-a', [question('q1')])
  const before = published
  // `askedAt` is persisted at enqueue, so the returning-user path is exactly
  // the same one a live clock walks: an entry whose window already closed is
  // still open, still answerable, and only its accent has lapsed.
  const storageKey = [...storage.keys()].find(key => key.includes('t8'))
  assert.ok(storageKey !== undefined, 'enqueue persists the accent clock')
  const saved = JSON.parse(storage.get(storageKey))
  assert.equal(typeof saved.askedAt, 'number')
  assert.equal(saved.state, 'open')
  storage.set(storageKey, JSON.stringify({ askedAt: Date.now() - 10 * 60_000, state: 'open' }))
  store.enqueue('t8', 'call-b', [question('q2')])
  assert.ok(published > before, 'an enqueue after the window still republishes')
  const entries = store.snapshot('t8')
  assert.deepEqual(entries.map(entry => entry.question.id), ['q1', 'q2'])
  assert.ok(entries.every(entry => entry.state === 'open'))
})

test('survives localStorage being unavailable', () => {
  const original = globalThis.window
  globalThis.window = { localStorage: { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } } }
  try {
    const store = freshStore()
    store.enqueue('t7', 'call-a', [question('q1')])
    assert.equal(store.snapshot('t7').length, 1)
    store.close(store.snapshot('t7')[0], 'answered')
    assert.deepEqual(store.snapshot('t7'), [])
  } finally {
    globalThis.window = original
  }
})

/**
 * The repaint clock is what makes the countdown move, and it is also the one
 * thing here that can keep a browser-less host alive. Both halves are asserted
 * below: it must be running while something is open, and it must be `unref`'d
 * and stopped once nothing is.
 */
test('runs one repaint clock only while a question is open, and unrefs it', () => {
  const created = []
  const cleared = []
  const realSetInterval = globalThis.setInterval
  const realClearInterval = globalThis.clearInterval
  globalThis.setInterval = (handler, delay) => {
    // `scheduleVisibility` uses setTimeout, so any interval seen here is ours.
    const unrefCalls = { count: 0 }
    const handle = { handler, delay, unref() { unrefCalls.count += 1 } }
    created.push({ handle, unrefCalls })
    return handle
  }
  globalThis.clearInterval = handle => { cleared.push(handle) }
  try {
    const store = freshStore()
    assert.equal(created.length, 0, 'no clock before anything is queued')

    store.enqueue('tick-1', 'call-a', [question('q1')])
    assert.equal(created.length, 1, 'queuing starts exactly one clock')
    assert.equal(created[0].handle.delay, 1000, 'the countdown needs second resolution')
    assert.equal(created[0].unrefCalls.count, 1,
      'an un-unref\'d interval keeps the process alive after its work is done')

    // A second question must reuse the clock rather than start a competing one.
    store.enqueue('tick-1', 'call-b', [question('q2')])
    assert.equal(created.length, 1, 'a second question reuses the running clock')

    // Every repaint is a publish, which is what the countdown renders from.
    const ticks = listener => { store.subscribe(listener) }
    let published = 0
    ticks(() => { published += 1 })
    created[0].handle.handler()
    assert.equal(published, 1, 'a tick republishes the snapshot')

    store.close(store.snapshot('tick-1')[0], 'answered')
    assert.equal(cleared.length, 0, 'one question is still open, so the clock keeps running')
    store.close(store.snapshot('tick-1')[0], 'skipped')
    assert.equal(cleared.length, 1, 'the clock stops once nothing is open')
    assert.equal(cleared[0], created[0].handle, 'the stopped clock is the one that was started')
  } finally {
    globalThis.setInterval = realSetInterval
    globalThis.clearInterval = realClearInterval
  }
})

test('skipAll and dispose both retire the repaint clock', () => {
  const created = []
  const cleared = []
  const realSetInterval = globalThis.setInterval
  const realClearInterval = globalThis.clearInterval
  globalThis.setInterval = () => { const handle = { unref() {} }; created.push(handle); return handle }
  globalThis.clearInterval = handle => { cleared.push(handle) }
  try {
    const skipped = freshStore()
    skipped.enqueue('tick-2', 'call-a', [question('q1')])
    skipped.skipAll('tick-2')
    assert.equal(created.length, 1)
    assert.equal(cleared.length, 1, 'skipAll retires the clock with the last open question')

    const disposed = freshStore()
    disposed.enqueue('tick-3', 'call-a', [question('q1')])
    assert.equal(created.length, 2, 'a fresh store starts its own clock')
    disposed.dispose()
    assert.equal(cleared.length, 2, 'dispose tears the clock down with the accent timers')
  } finally {
    globalThis.setInterval = realSetInterval
    globalThis.clearInterval = realClearInterval
  }
})
