import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

/**
 * Contract tests for the built Web bundle (`lib/client.js`).
 *
 * This file exists because a whole class of defect is invisible to the unit
 * tests next to it: they import `src/` modules directly, so they never touch
 * the artifact the browser actually executes. The shipped bundle once called
 * bare `React.createElement` in every slot component while binding only the
 * named hooks, so both of its UI surfaces died on render with
 * `ReferenceError: React is not defined` — the slot boundary swallowed the
 * throw and the user saw nothing at all. Every source-level test passed.
 *
 * The assertions below therefore run against the built file, and the load
 * test executes it for real rather than pattern-matching it. Run
 * `npm run build` first: `npm run check` sequences build ahead of test.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bundlePath = resolve(root, 'lib/client.js')
const bundle = readFileSync(bundlePath, 'utf8')

/**
 * Every module id the bundle requires, in source order.
 *
 * `require` calls are only collected when they carry a literal specifier —
 * which is exactly what the ModuleLoader contract needs, so a computed
 * specifier is a failure in its own right, not something to skip.
 * @returns the specifiers passed to `require(...)`.
 */
function requiredSpecifiers() {
  const found = []
  const pattern = /\brequire\(\s*(["'])([^"']+)\1\s*\)/g
  for (const match of bundle.matchAll(pattern)) found.push(match[2])
  return found
}

test('the bundle never calls a React identifier it does not bind', () => {
  // The classic JSX runtime emits `React.createElement`; the automatic runtime
  // emits `jsx`/`jsxs` from `react/jsx-runtime`. Only the latter is imported,
  // so any `React.` call site is necessarily a `ReferenceError` at runtime.
  const calls = bundle.match(/\bReact\.\w+/g) ?? []
  assert.deepEqual(
    calls, [],
    `lib/client.js calls ${[...new Set(calls)].join(', ')} but binds no React default import; `
    + 'set `jsx: \'automatic\'` in scripts/build.mjs and rebuild.',
  )
})

test('the bundle reaches the JSX runtime through the loader require it uses', () => {
  assert.ok(
    /\brequire\(\s*["']react\/jsx-runtime["']\s*\)/.test(bundle),
    'lib/client.js does not require("react/jsx-runtime"), so its JSX has no runtime to compile against.',
  )
  assert.deepEqual(requiredSpecifiers().filter(specifier => specifier.startsWith('.')), [],
    'a bundled-local path leaked into require(), so the read specifier is not a loader module id.')
})

test('the loader can execute the bundle and it registers both slot occurrences', () => {
  const registered = []
  const declarations = new Set()
  const inert = () => {}
  let loaded
  const load = (specifier, factory) => {
    const modules = {
      react: { createContext: () => ({}), useContext: inert, useEffect: inert, useMemo: inert, useState: inert, useSyncExternalStore: inert },
      'react/jsx-runtime': { jsx: inert, jsxs: inert, Fragment: 'Fragment' },
      // Every primitive the card renders with. A name the runtime does not
      // export would be `undefined` on the page rather than a build error, so
      // the stub deliberately offers exactly the ones the bundle asks for and
      // fails on anything else.
      '@deepseek-ai/dsh-client-ui-primitives': new Proxy({}, {
        get: (_target, key) => (typeof key === 'string' && /^[A-Z]/.test(key) ? inert : undefined),
        has: () => true,
      }),
    }
    // `window.__ModuleLoader__.load({ id, factory })` is the loader's entry
    // point, while the same bare `require` is what the factory body calls.
    const resolveModule = specifier => {
      assert.ok(Object.hasOwn(modules, specifier),
        `the bundle requires "${specifier}" at load time, which the loader does not offer.`)
      return modules[specifier]
    }
    if (typeof specifier === 'object' && specifier !== null) {
      assert.equal(specifier.id, 'dsh-proactive-questioning', 'the bundle declares an unexpected module id.')
      assert.equal(typeof specifier.factory, 'function', 'the loader entry carries no factory.')
      loaded = specifier.factory(resolveModule)
      return loaded
    }
    return resolveModule(specifier)
  }

  const sandbox = {
    window: { __ModuleLoader__: { load } },
    require: load,
    module: { exports: {} },
    exports: {},
    console,
  }
  runInContext(bundle, createContext(sandbox))

  // The bundle rebinds `module.exports` to its own object inside the factory,
  // so the applied factory's return value is the export surface. It is read
  // field-wise because esbuild hands back a namespace written in another
  // realm, whose array prototypes do not match this one's.
  const apply = loaded?.apply
  assert.equal(typeof apply, 'function', 'the bundle did not export its client plugin as apply().')
  assert.equal([...loaded.inject].join(','), 'slots,sessions,locale',
    'the client plugin no longer declares the slots and sessions services.')

  // `slots.inject(key, callback)` runs the callback with no arguments once the
  // slot has a declaration (`registry.ts`), and the registration it makes
  // through `slots.register` is what carries the declaration.
  apply({ effect: fn => fn(), locale: { register: () => () => {} }, slots: {
    registerFactory: () => () => {},
    inject: (_key, callback) => { callback(); return () => {} },
    register: (registration, component) => {
      for (const name of Object.keys(registration.children ?? {})) {
        assert.equal(declarations.has(name), false, `slot ${name} has more than one declaring owner`)
        declarations.add(name)
      }
      registered.push({ ...registration, component })
      return () => {}
    },
  } })

  assert.equal(registered.map(entry => entry.name).sort().join(','),
    'conversation.chat.node,conversation.chat.node,conversation.input.dock,tool.call.toolview',
    'the client plugin no longer registers both of its slot occurrences.')
  assert.equal(registered.find(entry => entry.name === 'tool.call.toolview').key, 'queue_user_question',
    'the tool view is no longer keyed to queue_user_question.')

  const dock = registered.find(entry => entry.name === 'conversation.input.dock')
  // Session-scope inject factories are called with the id as a positional
  // argument. A factory that reads `props.sessionId` resolves undefined for
  // every occurrence and the dock renders nothing.
  assert.equal(typeof dock.inject, 'function', 'the dock no longer declares an inject face.')
  assert.equal(Object.keys(dock.inject('session-under-test')).join(','), 'send',
    'the dock inject face must expose exactly the send verb keyed off the positional session id.')
  assert.equal(dock.inject(undefined).send, undefined,
    'an occurrence without a usable session id must degrade to no send verb instead of throwing.')

  const source = resolve(process.env.DSH_SOURCE_ROOT ?? resolve(root, '../../../deepseek-harness'), 'packages/client/ui-slots/src/index.ts')
  const compiled = buildSync({ entryPoints: [source], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text
  const module = { exports: {} }
  runInContext(compiled, createContext({ module, exports: module.exports, console, queueMicrotask }))
  const core = new module.exports.SlotCore()
  core.register({ name: 'root', children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' } } }, () => null)
  for (const key of ['user', 'steering']) {
    const ordinary = () => null
    core.register({ name: 'conversation.chat.node', key }, ordinary)
    const own = registered.find(item => item.name === 'conversation.chat.node' && item.key === key)
    const disposeOwn = core.register(own, own.component)
    const winner = () => core.entriesOfSlot('conversation.chat.node').find(item => item.options.key === key).component
    assert.equal(winner(), own.component, 'answer presentation must win over the host default')
    const rabi = () => null
    const disposeRabi = core.register({ name: 'conversation.chat.node', key, priority: -10 }, rabi)
    assert.equal(winner(), rabi, 'the source-envelope renderer retains its caller role')
    disposeRabi()
    assert.equal(winner(), own.component)
    disposeOwn()
    assert.equal(winner(), ordinary, 'unloading restores the host renderer')
  }
})

test('the shipped bundle contains no local Windows build path', () => {
  assert.doesNotMatch(bundle, /[A-Za-z]:[\\/]/)
})
