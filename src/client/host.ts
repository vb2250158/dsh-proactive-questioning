/**
 * Access to the client services carried by a slot occurrence's context.
 *
 * The client runtime installs `ctx.slots` on every client Cordis context, and
 * `main.conversation` — the entry that renders the composer, and therefore
 * this plugin's dock — resolves its occurrence context to the *current*
 * Session's scoped context. Session-scope standard props ride that same scope:
 * `useSession` is a selector over the current Session, so an occurrence
 * mounted for a non-current Session (a background tab, for example) must
 * resolve its own Session through `uiSession.adapter.resolve(sessionId)`
 * instead of reading `useSession`.
 *
 * This module is the single seam that depends on the `uiSession` service
 * shape, and it is absent-safe: every lookup is optional, so a runtime without
 * the service degrades to "no questions rendered" rather than crashing the
 * composer.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** Host-observable source shape (getSnapshot/subscribe pair). */
interface Observable {
  getSnapshot: () => unknown
  subscribe: (listener: () => void) => () => void
}

/**
 * A Session-scope standard binding as the renderer materializes it. `hooks`
 * and `props` are the raw sources, so a caller can bind them through the
 * occurrence's own standard kit instead of reaching for a store directly.
 */
export interface SessionScopeBinding {
  readonly key: string
  readonly hooks: Readonly<Record<string, Observable | undefined>>
  readonly props: Readonly<Record<string, unknown>>
}

/** The slice of the `uiSession` service this plugin consumes. */
interface UiSessionLike {
  readonly adapter?: {
    resolve?: (sessionId: string) => SessionScopeBinding | undefined
  }
}

/**
 * Read the slot occurrence's client context off an entry's props.
 *
 * The renderer injects `ctx` into every session-scope entry (its Session
 * standard props merge declares it), so a plugin reads its occurrence context
 * from props rather than holding render-time state in a module variable.
 * @param props - the entry's runtime props.
 * @returns the occurrence's client context, or undefined when absent.
 */
export function contextFromProps(props: object): ClientContext | undefined {
  const candidate = (props as { ctx?: unknown }).ctx
  if (candidate === null || typeof candidate !== 'object') return undefined
  return (candidate as { slots?: unknown }).slots === undefined ? undefined : candidate as ClientContext
}

/**
 * Resolve one Session's scope binding through the installed `uiSession`
 * service.
 * @param ctx - the occurrence context.
 * @param sessionId - Session identity to resolve.
 * @returns the binding, or undefined when the service is missing or the
 * Session has no Controller binding yet.
 */
export function sessionBinding(ctx: ClientContext | undefined, sessionId: string): SessionScopeBinding | undefined {
  const service = ctx?.get?.('uiSession') as UiSessionLike | undefined
  const resolve = service?.adapter?.resolve
  if (typeof resolve !== 'function') return undefined
  try {
    return resolve.call(service?.adapter, sessionId)
  } catch {
    return undefined
  }
}
