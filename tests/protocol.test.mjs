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

test('保留图文说明与原始标签，并拒绝超长或错误类型的正文', () => {
  const detail = '说明前\n\n![示意图](<C:/work folder/a.png>)\n\n说明后'
  const option = { label: '方案 A (推荐)', description: '文字\n\n![预览](https://example.test/a.png)' }
  assert.deepEqual(normalizeQuestions({ questions: [{ id: 'q', question: '选择布局', detail, options: [option] }] }), [{ id: 'q', question: '选择布局', detail, options: [option] }])
  for (const invalid of [42, '', 'x'.repeat(12001)]) {
    assert.throws(() => normalizeQuestions({ questions: [{ id: 'q', question: '选择布局', detail: invalid }] }))
    assert.throws(() => normalizeQuestions({ questions: [{ id: 'q', question: '选择布局', options: [{ label: 'A', description: invalid }] }] }))
  }
})

test('the "new" accent window is long enough to survive a long Agent turn', () => {
  // The window used to be 30s. It only controls the visual accent now, but a
  // short accent made a question the user never saw arrive with no emphasis at
  // all, so keep a floor on it.
  assert.ok(ACTIVE_WINDOW_MS >= 60_000, `accent window is ${ACTIVE_WINDOW_MS}ms`)
  const askedAt = 1000
  assert.equal(questionVisibility(askedAt, askedAt + ACTIVE_WINDOW_MS - 1), 'active')
  assert.equal(questionVisibility(askedAt, askedAt + ACTIVE_WINDOW_MS), 'bubble')
})
