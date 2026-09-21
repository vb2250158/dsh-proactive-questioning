import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('../src/client/question-card.module.css', import.meta.url), 'utf8')

test('question surfaces use host theme tokens', () => {
  assert.doesNotMatch(source.replaceAll('#0000', ''), /#[0-9a-fA-F]{3,8}\b/)
  assert.doesNotMatch(source, /prefers-color-scheme|\[data-theme/)
})

test('scrolling content leaves footer actions reachable', () => {
  assert.match(source, /\.body\s*\{[^}]*min-height: 0;[^}]*overflow-y: auto;/)
  assert.match(source, /\.footer\s*\{[^}]*flex-shrink: 0;/)
  assert.match(source, /prefers-reduced-motion: reduce/)
})
