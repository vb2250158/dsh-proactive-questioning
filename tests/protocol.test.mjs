import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeQuestions, queuedResult } from '../src/protocol.mjs'
import { ACTIVE_WINDOW_MS, questionVisibility } from '../src/client/lifecycle.mjs'

test('normalizes an optional question and returns an immediate continuation acknowledgement', () => {
  const questions = normalizeQuestions({
    questions: [{ id: 'direction', question: '接下来更看重速度还是完整性？', options: [{ label: '速度' }, { label: '完整性' }] }],
  })
  assert.deepEqual(questions, [{ id: 'direction', question: '接下来更看重速度还是完整性？', options: [{ label: '速度' }, { label: '完整性' }] }])
  assert.deepEqual(queuedResult(questions), {
    status: 'queued', questionIds: ['direction'],
    continuation: 'The question was shown without waiting. Continue independently and treat silence as no answer.',
  })
})

test('rejects duplicate ids and invalid optional choices', () => {
  assert.throws(() => normalizeQuestions({ questions: [{ id: 'x', question: 'A' }, { id: 'x', question: 'B' }] }), /不能重复/)
  assert.throws(() => normalizeQuestions({ questions: [{ id: 'x', question: 'A', options: [] }] }), /选项数量无效/)
})

test('questions collapse to a bubble after exactly thirty seconds without expiring', () => {
  const askedAt = 1000
  assert.equal(questionVisibility(askedAt, askedAt + ACTIVE_WINDOW_MS - 1), 'active')
  assert.equal(questionVisibility(askedAt, askedAt + ACTIVE_WINDOW_MS), 'bubble')
})
