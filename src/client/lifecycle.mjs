export const ACTIVE_WINDOW_MS = 30_000

/** A queued question remains directly visible for 30 seconds, then only its bubble remains. */
export function questionVisibility(askedAt, now = Date.now()) {
  return now - askedAt < ACTIVE_WINDOW_MS ? 'active' : 'bubble'
}
