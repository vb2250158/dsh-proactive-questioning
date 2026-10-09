import assert from 'node:assert/strict'
import test from 'node:test'
import { answerText, parseAnswerText } from '../src/client/answer-message.mjs'

const entry = { callId: 'call-1', question: { id: 'q-1', question: '今天继续哪项工作？' } }

test('selected values and custom text survive the durable answer envelope', () => {
  const selected = ['看消息 (Recommended)', '看文档']
  const custom = '只看今天\n有问题再启动'
  assert.deepEqual(parseAnswerText(answerText(entry, selected, custom)), { question: entry.question.question, selected, custom })
})

test('recognizes the historical custom-only answer and multiline questions', () => {
  const item = { ...entry, question: { ...entry.question, question: '第一行\n「第二行」的回答：\n第三行' } }
  assert.deepEqual(parseAnswerText(answerText(item, [], '今天的消息')), { question: item.question.question, selected: [], custom: '今天的消息' })
})

test('unrelated, malformed and extended messages remain verbatim', () => {
  const good = answerText(entry, [], '看看消息')
  for (const text of ['普通消息', good + '\n还有一件事', good.replace('"selected":[]', '"selected":[1]'), good.replace('"custom":"看看消息"', '"custom":1'), good.replace('"custom":"看看消息"', '"custom":""'), good.replace('"custom":"看看消息"', '"custom":"看看消息","extra":true'), good.replace('{"questionId"', '{broken,"questionId"')]) {
    assert.equal(parseAnswerText(text), undefined)
  }
})
