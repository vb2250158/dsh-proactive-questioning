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
