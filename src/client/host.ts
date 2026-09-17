/**
 * Identity plumbing for the two slot occurrences this plugin owns.
 *
 * The client slot system derives a registrant's inject arguments from the
 * registration's *declaration*, not from props: a `session`-scope
 * `inject` factory is called as `inject(sessionId, actions?)`
 * (`InjectParams` in `@deepseek-ai/dsh-client-ui-slots`, and `runInject` in
 * the renderer's `scoped-slots.tsx`, which pushes `binding.key` as the first
 * argument). A session-scope component additionally receives `SessionStandardProps`
 * — `sessionId`, `useSession` and `useProjection` merged in by `ui-session` —
 * so `sessionId` is a real prop as well.
 *
 * The shipped `GoalDock` (`ui-goal`) is the reference implementation for the
 * same `conversation.input.dock` slot: it takes `inject: (sessionId) => …`
 * and never reads identity from `props`. Reading `props.sessionId` inside an
 * `inject` factory is the failure this module replaces — the factory's first
 * argument is a bare id string, so `props.sessionId` is always `undefined`
 * and every occurrence resolves to "no session", which renders nothing at
 * all.
 *
 * Business data access stays on the apply closure's `ctx`; no binding object
 * is passed around (`InjectParams` states this explicitly). The only thing
 * this module does is turn the positional `sessionId` into the two things the
 * dock needs: a validated id, and a send verb addressed to that id.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Narrow an inject argument to a usable Session id.
 *
 * The declaration guarantees a definite `sessionId` for a `session`-scope
 * entry, but the value still arrives as `unknown` at runtime and a
 * session-less occurrence must not throw inside the composer.
 * @param value - the inject factory's first argument.
 * @returns the id when it is a non-empty string.
 */
export function asSessionId(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Build the send verb for one Session.
 *
 * `ctx.sessions.scope(id).conversation.send` is the scope-addressed send
 * documented by `ui-conversation` ("address one via
 * `ctx.sessions.scope(id).conversation`"). Resolving per call rather than
 * once keeps the verb correct when the Session's Controller binding is
 * established after this occurrence mounts, and a missing scope surfaces as a
 * rejected promise instead of a crash in the composer.
 * @param ctx - the apply closure's client context.
 * @param sessionId - the occurrence's Session identity.
 * @returns a send function, or undefined when the session is unusable.
 */
export function scopedSend(ctx: ClientContext, sessionId: string | undefined): ((text: string) => Promise<unknown>) | undefined {
  if (sessionId === undefined) return undefined
  return async (text: string): Promise<unknown> => {
    const scope = ctx.sessions?.scope?.(sessionId)
    if (scope === undefined) throw new Error('原对话尚未加载，无法发送回答。')
    return await scope.conversation.send(text)
  }
}
