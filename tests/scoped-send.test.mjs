import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The dock's outbound send verb, against the Cordis scope contract it actually
 * meets at runtime.
 *
 * Why this file exists: the shipped bundle read `scope.conversation.send(text)`,
 * and a Cordis context is a Proxy whose `get` trap throws
 * `cannot get property "conversation" without inject` for any service the
 * context has not been *given* — see `vendor/cordis/src/reflect.ts:144`. The
 * scope is `any`-shaped at this boundary, so the property read compiled fine
 * and only failed when a user pressed 提交. Nothing in the unit suite touched
 * this function; every test passed while the feature was unusable.
 *
 * The scope double below is the point of the file. A plain object stub would
 * make the buggy code pass, because reading `.conversation` off a plain object
 * just works — the defect lives in the *shape* of the real scope, so the double
 * has to throw on property read and resolve on `get()`. Both directions are
 * asserted so the test cannot pass by the double being wrong instead of the
 * code being right.
 *
 * The function is reached through the built bundle, not by importing `src/`,
 * because the failure mode was a build-level mismatch between source and
 * artifact. A source-level import would have been green the whole time.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bundle = readFileSync(resolve(root, 'lib/client.js'), 'utf8')

/**
 * Build the bundle's slot registration the way the renderer does.
 * @param sessions - the `ctx.sessions` double the send verb will resolve scopes through.
 * @returns the registered dock component and the apply closure's context.
 */
function loadBundle(sessions, sessionId = 's1') {
  const context = createContext({
    window: {
      __ModuleLoader__: {
        load({ factory }) {
          this.registered = factory(specifier => {
            if (specifier === 'react') return { createContext: () => ({}), useContext: () => undefined, useEffect: () => {}, useMemo: () => undefined, useRef: () => ({ current: undefined }), useState: () => [undefined, () => {}], useSyncExternalStore: () => 0 }
            if (specifier === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null, Fragment: null }
            if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return new Proxy({}, { get: () => () => null, has: () => true })
            throw new Error(`unbound module: ${specifier}`)
          })
        },
      },
    },
  })
  context.globalThis = context
  runInContext(bundle, context)
  const exports = context.window.__ModuleLoader__.registered

  const calls = []
  let regs = []
  const ctx = {
    effect: () => {},
    sessions,
    slots: {
      inject: (name, setup) => { calls.push({ name, setup }); return () => {} },
      register: (options, component) => { regs.push({ slot: ctx.open, options, component }); return () => {} },
    },
  }
  exports.apply(ctx)
  for (const call of calls) {
    ctx.open = call.name
    call.setup({ name: call.name, register: () => {} })
  }
  const dock = regs.find(entry => entry.options.id === 'proactive-questioning-dock')
  assert.ok(dock !== undefined, 'the dock slot must register, or the send path is untestable')
  // The inject factory is what turns the positional sessionId into the send
  // verb; calling it the way the renderer does is the only way to reach it.
  return dock.options.inject(sessionId)
}

/**
 * A scope shaped like a real Cordis AgentContext: reading a service property
 * throws (the context was never `inject`ed for it), while `get(name)` resolves
 * strictly and returns undefined for an absent service.
 * @param services - the services this scope can actually hand over.
 * @returns the scope double.
 */
function cordisScope(services) {
  return new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop]
      if (prop === 'get') return name => services[name]
      // Mirror the framework exactly: the message a user saw in the report.
      throw new Error(`cannot get property "${String(prop)}" without inject`)
    },
  })
}

test('a scope that can hand over conversation sends through it', async () => {
  const sent = []
  const props = loadBundle({
    scope: () => cordisScope({ conversation: { send: async text => { sent.push(text); return { ok: true } } } }),
  })
  assert.equal(typeof props.send, 'function', 'the dock must expose a send verb')
  await props.send('hello')
  assert.deepEqual(sent, ['hello'], 'the verb must reach the scoped conversation service')
})

test('a scope that cannot hand over conversation rejects instead of throwing the framework error', async () => {
  // The regression: reading `scope.conversation` threw the framework's own
  // message out of a click handler. `get()` returns undefined here, so the
  // plugin reports its own, actionable failure.
  const props = loadBundle({ scope: () => cordisScope({}) })
  await assert.rejects(
    () => props.send('hello'),
    error => {
      assert.doesNotMatch(error.message, /without inject/,
        "the framework's proxy error must not escape to the user")
      assert.match(error.message, /会话服务当前不可用/, 'the reader must be told the service is unavailable')
      return true
    },
  )
})

test('a missing scope and an unusable scope report different failures', async () => {
  // Collapsing these would cost the reader the only clue that says which half
  // is broken: an unmounted Session versus a Session whose tree lacks the
  // service.
  const noScope = loadBundle({ scope: () => undefined })
  await assert.rejects(() => noScope.send('x'), /原对话尚未加载/)

  const unusable = loadBundle({ scope: () => cordisScope({}) })
  await assert.rejects(() => unusable.send('x'), /会话服务当前不可用/)
})

test('an absent session id produces no send verb at all', () => {
  const props = loadBundle({ scope: () => { throw new Error('must not resolve a missing session') } }, '')
  assert.equal(props.send, undefined)
})

test('the built artifact resolves the service through get, never through a property read', () => {
  // The source-level assertion that would have caught the original defect: the
  // property read is what throws, so its absence from the artifact is the fix.
  assert.doesNotMatch(bundle, /scope\.conversation/,
    'the artifact must not read conversation off the scope as a property')
  assert.match(bundle, /\.get\(["']conversation["']\)/,
    'the artifact must claim the service through Scope#get')
})
