import assert from 'node:assert/strict'
import test from 'node:test'
import { ACTIVE_WINDOW_MS, questionRemainingSeconds, questionVisibility } from '../src/client/lifecycle.mjs'

/**
 * The countdown is a fresh-period read-out, not an expiry.
 *
 * Both halves of that sentence are load-bearing and both are easy to break by
 * accident: the number must track the accent window exactly (or the card
 * contradicts its own emphasis), and the window closing must yield "no number"
 * rather than a state a caller could mistake for "this question is going away".
 */

test('counts down the fresh period and agrees with the accent window', () => {
  const askedAt = 1_000_000
  // Full window at the instant of asking.
  assert.equal(questionRemainingSeconds(askedAt, askedAt), ACTIVE_WINDOW_MS / 1000)
  // A whole second in, one second fewer.
  assert.equal(questionRemainingSeconds(askedAt, askedAt + 1_000), ACTIVE_WINDOW_MS / 1000 - 1)
  // The countdown and the emphasis must flip at the same instant, or the card
  // shows a number beside a card that has already stopped being highlighted.
  const last = askedAt + ACTIVE_WINDOW_MS - 1
  assert.equal(questionVisibility(askedAt, last), 'active')
  assert.equal(questionRemainingSeconds(askedAt, last), 1)
})

test('rounds up, so a displayed second is never shorter than a second', () => {
  const askedAt = 5_000_000
  // 1500ms in: 118.5s left. Floor would read 118 while the accent still shows
  // "new" for another half second; ceil keeps the last value at 1, never 0.
  assert.equal(questionRemainingSeconds(askedAt, askedAt + 1_500), 119)
  assert.equal(questionRemainingSeconds(askedAt, askedAt + ACTIVE_WINDOW_MS - 500), 1)
})

test('reports no remaining time once the window has passed, and still nothing is hidden', () => {
  const askedAt = 9_000_000
  assert.equal(questionRemainingSeconds(askedAt, askedAt + ACTIVE_WINDOW_MS), undefined)
  assert.equal(questionRemainingSeconds(askedAt, askedAt + ACTIVE_WINDOW_MS + 600_000), undefined)
  // The visibility in the same moment is "bubble" — a normal pending entry,
  // not a settled one. There is no third state a caller could read as expiry.
  assert.equal(questionVisibility(askedAt, askedAt + ACTIVE_WINDOW_MS), 'bubble')
})

test('a clock in the past does not produce a count above the window', () => {
  // A stored `askedAt` from a machine ahead of this one, or a backwards clock
  // correction, must not show a countdown longer than the window itself.
  const askedAt = 20_000_000
  assert.equal(questionRemainingSeconds(askedAt, askedAt - 5_000), ACTIVE_WINDOW_MS / 1000)
})
