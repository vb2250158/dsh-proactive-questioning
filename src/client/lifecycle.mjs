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
