/**
 * How long one occurrence stays highlighted as the newest question. The dock
 * itself stays visible for as long as the question is unanswered — this window
 * only decides which occurrence keeps the "new" accent, because a question the
 * user never saw is not something a short timer may hide.
 */
export const ACTIVE_WINDOW_MS = 120_000

/** A queued question keeps its "new" accent for 120 seconds, then reads as a normal pending entry. */
export function questionVisibility(askedAt, now = Date.now()) {
  return now - askedAt < ACTIVE_WINDOW_MS ? 'active' : 'bubble'
}

/**
 * Seconds of fresh-period left, or undefined once the window has passed.
 *
 * Counts the remainder of the same accent window, so the number on screen and
 * the emphasis around it always agree. `undefined` means "the fresh period is
 * over", NOT "the question is about to disappear" — nothing here expires, and
 * a caller that hides or closes the question on this signal is wrong. Rounds up
 * so a displayed second is never shorter than a second and the last visible
 * value is 1 rather than 0, and never exceeds the window itself, so a stored
 * `askedAt` from a clock ahead of this one cannot show a longer countdown than
 * the window it measures.
 * @param askedAt - when the question was enqueued.
 * @param now - the instant to measure against.
 * @returns seconds remaining in the fresh period, or undefined when it is over.
 */
export function questionRemainingSeconds(askedAt, now = Date.now()) {
  const elapsed = Math.max(0, now - askedAt)
  if (elapsed >= ACTIVE_WINDOW_MS) return undefined
  return Math.ceil((ACTIVE_WINDOW_MS - elapsed) / 1000)
}
