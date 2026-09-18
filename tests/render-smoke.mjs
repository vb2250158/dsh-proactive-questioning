/**
 * Host-side render smoke: drives the BUILT bundle through real React in a real
 * DOM and asserts what the user actually sees.
 *
 * Why this exists next to the `.test.mjs` suite: that suite loads the bundle in
 * a `node:vm` sandbox that renders nothing, so it can only prove wiring. Two
 * whole classes of defect are invisible to it, and both were real:
 *
 *  - a bundle that registered its slots but threw on render (the classic-JSX
 *    `React is not defined` bug), because the slot boundary swallows the throw
 *    and the user just sees an empty panel; and
 *  - a countdown that removed the question once the window lapsed, which is the
 *    one thing a non-blocking question must never do.
 *
 * It is a host tool, not a plugin dependency: `react`, `react-dom`, and `jsdom`
 * are resolved out of the surrounding DSH workspace, so `npm test` stays
 * dependency-free.
 *
 *   node tests/render-smoke.mjs [--workspace <deepseek-harness root>]
 *
 * Exits non-zero on the first failed assertion.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = join(here, '..')

const argv = process.argv.slice(2)
const flag = argv.indexOf('--workspace')
const workspace = flag === -1 ? 'C:/Data/CottonProject/deepseek-harness' : argv[flag + 1]
const pnpm = join(workspace, 'node_modules/.pnpm')
assert.ok(existsSync(pnpm), `expected a pnpm workspace at ${pnpm}`)

const find = prefix => {
  const match = readdirSync(pnpm).find(name => name.startsWith(prefix))
  assert.ok(match !== undefined, `${prefix} must be installed in the workspace`)
  return join(pnpm, match, 'node_modules', prefix.replace(/@[^@/]+$/, '').replace(/$/, ''), 'package.json')
}

const domRequire = createRequire(find('react-dom@').replace(/[\\/]package\.json$/, '/package.json'))
const React = domRequire('react')
const ReactDOMClient = domRequire('react-dom/client')
const act = React.act ?? domRequire('react-dom/test-utils').act
const { JSDOM } = createRequire(find('jsdom@'))('jsdom')

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true,
  url: 'http://localhost/',
})
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const bundle = readFileSync(join(pluginRoot, 'lib/client.js'), 'utf8')

// Primitives render as a tag named after themselves, so assertions can name the
// exact primitive the card reached for without depending on its real markup.
const primitives = new Proxy({}, {
  get: (_target, key) => {
    if (typeof key !== 'string' || !/^[A-Z]/.test(key)) return undefined
    const Stub = props => React.createElement('i', { 'data-prim': key }, props?.children ?? null)
    Stub.displayName = key
    return Stub
  },
  has: () => true,
})

const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  TextEncoder, TextDecoder, URLSearchParams, Error, JSON, Math, Date, Promise,
  Object, Array, String, Number, Boolean, RegExp, Map, Set, WeakMap, Symbol,
  window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  localStorage: dom.window.localStorage,
  addEventListener() {}, removeEventListener() {},
}
sandbox.globalThis = sandbox
sandbox.self = sandbox
sandbox.require = specifier => {
  if (specifier === 'react') return React
  if (specifier === 'react/jsx-runtime') return domRequire('react/jsx-runtime')
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`the bundle required an unbound module: ${specifier}`)
}

const loaded = []
const loader = {
  load({ id, factory }) { loaded.push({ id, exports: factory(sandbox.require) }) },
}
sandbox.__ModuleLoader__ = loader
// The bundle reaches the loader as `window.__ModuleLoader__`, so the same object
// has to hang off the DOM window it sees as well.
dom.window.__ModuleLoader__ = loader

vm.createContext(sandbox)
vm.runInContext(bundle, sandbox, { filename: 'client.js' })

const ctx = {
  effect: fn => (typeof fn === 'function' ? fn() : undefined),
  sessions: {},
  slots: {
    inject(name, setup) { (ctx.calls ??= []).push({ name, setup }); return () => {} },
    register: () => () => {},
  },
}

/** Renders that threw outside React's own error path, e.g. a swallowed slot throw. */
const crashes = []
dom.window.addEventListener('error', event => { crashes.push(event.error ?? event.message) })

const [entry] = loaded
assert.ok(entry !== undefined, 'the bundle must call window.__ModuleLoader__.load once')
entry.exports.apply(ctx)

const regs = []
ctx.slots.register = (options, component) => {
  regs.push({ slot: ctx.open, options, component })
  return () => {}
}
for (const call of ctx.calls ?? []) {
  ctx.open = call.name
  call.setup({ name: call.name, register: () => { throw new Error('the bundle used the slot-local register') } })
}
assert.equal(regs.length, 2, 'both occurrences must register')
const toolview = regs.find(reg => reg.options.key === 'queue_user_question')
const dock = regs.find(reg => reg.options.id === 'proactive-questioning-dock')
assert.ok(toolview !== undefined, 'the queue_user_question toolview must register')
assert.ok(dock !== undefined, 'the dock must register')

const host = document.getElementById('root')
const mount = (component, props) => {
  const target = document.createElement('div')
  host.appendChild(target)
  const root = ReactDOMClient.createRoot(target)
  act(() => { root.render(React.createElement(component, props)) })
  return target
}

// 1. The tool row mirrors its questions into the store. It is the only entry
//    point that feeds the dock, so a failure here removes the whole UI.
const argsRaw = JSON.stringify({ questions: [
  { id: 'q1', header: '午餐', question: '午餐吃面还是饭？', options: [{ label: '面 (recommended)', description: '更快' }, { label: '饭' }] },
  { id: 'q2', question: '要加辣吗？', options: [{ label: '加' }, { label: '不加' }], multi_select: true },
] })
const rowHost = mount(toolview.component, { sessionId: 'session-a', callId: 'call-1', block: { kind: 'result', call: { argsRaw } } })
assert.match(rowHost.textContent, /已加入非阻塞问题/, 'the toolview must render its acknowledgement')

// 2. The dock renders the session's questions, newest one expanded.
const dockHost = mount(dock.component, { sessionId: 'session-a', send: async () => undefined })
await act(async () => { await new Promise(resolve => { setTimeout(resolve, 50) }) })
assert.ok(dockHost.querySelector('[data-dsh-proactive-questions]') !== null, 'the dock must render')
assert.ok(dockHost.querySelector('[data-dsh-question-card]') !== null, 'the newest question must expand into a card')
assert.match(dockHost.textContent, /共 2 个/, 'the dock must report how many questions are waiting')
assert.doesNotMatch(dockHost.textContent, /它不会等你/, 'the removed copy must not come back')
assert.equal(crashes.length, 0, `no render crash may be swallowed: ${crashes.map(String).join('; ')}`)

// 3. The countdown starts at the window and ticks on its own, driven by the store clock.
const countdown = () => dockHost.querySelector('[data-dsh-question-countdown]')
assert.ok(countdown() !== null, 'the card must carry a countdown')
assert.equal(countdown().getAttribute('data-state'), 'counting', 'a fresh question counts down')
assert.equal(countdown().textContent, '120s', 'the countdown starts at the whole window')
const firstRead = countdown().textContent
await act(async () => { await new Promise(resolve => { setTimeout(resolve, 2100) }) })
assert.notEqual(countdown().textContent, firstRead, 'the countdown must repaint on its own')

// 4. An older question still opens, carrying the blocking card's affordances.
const answer = [...dockHost.querySelectorAll('button')].find(button => button.textContent === '回答')
assert.ok(answer !== undefined, 'older questions must stay reachable')
act(() => { answer.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
assert.match(dockHost.textContent, /午餐吃面还是饭？/, 'the clicked question must open')
assert.equal(dockHost.querySelectorAll('[data-dsh-question-option]').length, 2, 'both options must render')
assert.match(dockHost.textContent, /推荐/, 'the recommended option must be badged')
assert.match(dockHost.textContent, /1 \/ 2/, 'the pager must report the position')
assert.match(dockHost.textContent, /跳过本题/, 'the skip control must be offered')
assert.match(dockHost.textContent, /提交/, 'the submit control must be offered')

// 5. THE critical one. Wind the clock past the accent window: the question must
//    stay on screen and stay answerable. Nothing may auto-close or auto-skip.
const realNow = Date.now.bind(Date)
Date.now = () => realNow() + 130_000
try {
  await act(async () => { await new Promise(resolve => { setTimeout(resolve, 1200) }) })
  assert.ok(dockHost.querySelector('[data-dsh-question-card]') !== null, 'the card must survive the window lapsing')
  assert.equal(countdown().getAttribute('data-state'), 'settled', 'the countdown must report the window as settled')
  assert.equal(countdown().textContent, '已保留', 'a lapsed window reads as kept, not as expired')
  assert.equal(dockHost.querySelectorAll('[data-dsh-question-option]').length, 2, 'the options must stay rendered')
  // The footer controls are primitives, so their label rides the stub's child
  // rather than the button's own text; assert on the control, not the string.
  const submit = dockHost.querySelector('[data-prim="Button"]')
  assert.ok(submit !== null, 'the submit control must stay rendered')
  assert.match(dockHost.textContent, /跳过本题/, 'the skip control must stay rendered')
  assert.match(dockHost.textContent, /提交/, 'the submit control must stay labelled')
  assert.match(dockHost.textContent, /回答/, 'the dock must still offer the older question')
} finally {
  Date.now = realNow
}

// 6. Collapsing hides the bodies but keeps the bar and the count.
const settledRead = countdown().textContent
const bar = dockHost.querySelector('button[aria-expanded]')
act(() => { bar.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
assert.ok(dockHost.querySelector('[data-dsh-question-card]') === null, 'collapsing must hide the card')
assert.match(dockHost.textContent, /Agent 想听听你的想法/, 'collapsing must keep the bar')

console.log('render smoke: all assertions passed')
console.log(`  countdown repainted ${firstRead} -> ..., and read ${settledRead} once the window lapsed`)
console.log('  a lapsed window kept the question answerable; no render crash was swallowed')
