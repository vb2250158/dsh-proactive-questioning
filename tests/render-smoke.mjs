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
    if (key === 'projectUserText') return text => text
    if (key === 'fileExtension') return path => path.split('.').at(-1)
    if (key === 'fileSizeText') return bytes => `${bytes} B`
    if (key === 'writeClipboard') return async text => { clipboard.push(text); return true }
    if (typeof key !== 'string' || !/^[A-Z]/.test(key)) return undefined
    const Stub = props => key === 'Button'
      ? React.createElement('button', { disabled: props.disabled, onClick: props.onClick, 'aria-label': props['aria-label'], 'data-prim': key }, props.children)
      : React.createElement('span', { 'data-prim': key }, props?.children ?? null)
    Stub.displayName = key
    return Stub
  },
  has: () => true,
})
const clipboard = []

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
    locale: { register: () => () => {} },
  slots: {
    registerFactory: (options, component) => { ctx.factory = { options, component }; return () => {} },
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
assert.equal(regs.length, 4, 'both occurrences must register')
const toolview = regs.find(reg => reg.options.key === 'queue_user_question')
const translate = key => ({ send: '发送回答', sending: '发送中…', sent: '已发送' })[key] ?? key
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
assert.equal(rowHost.textContent, '待回答', 'the acknowledgement contains only the answer status')

// 2. The dock renders the session's questions, newest one expanded.
const dockHost = mount(dock.component, { t: translate, sessionId: 'session-a', send: async () => undefined })
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
assert.match(dockHost.textContent, /发送回答/, 'the send control must be offered')

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
  assert.match(dockHost.textContent, /发送回答/, 'the send control must stay labelled')
  assert.match(dockHost.textContent, /回答/, 'the dock must still offer the older question')
} finally {
  Date.now = realNow
}

// 6. Collapsing hides the bodies but keeps the bar and the count.
const settledRead = countdown().textContent
const bar = dockHost.querySelector('button[aria-expanded]')
act(() => { bar.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
assert.ok(dockHost.querySelector('[data-dsh-question-card]') === null, 'collapsing must hide the card')
assert.match(dockHost.textContent, /需要你的意见/, 'collapsing must keep the bar')
act(() => { bar.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })

// 7. The card must be STYLED, not merely structured. This is the assertion that
//    catches a hand-rolled approximation: without the stylesheet the classes are
//    cosmetic tokens and every rule — radius, surface, indicator geometry — is
//    absent, yet the DOM and the copy look perfect. The card is a transcription
//    of the blocking card's stylesheet, so the values are asserted directly.
const styles = [...document.querySelectorAll('style[data-plugin-css]')]
assert.ok(styles.length > 0, 'the bundle must inject its stylesheet')
const sheet = styles.map(tag => tag.textContent).join('\n')
assert.match(sheet, /\.\w+_card\b/, 'the stylesheet must scope the card class')
for (const [declaration, why] of [
  ['border-radius:20px', 'the dock radius'],
  ['background:var(--dsw-specific-input-major)', "the blocking card's input surface"],
  ['padding:0 24px 10px', 'the question header insets'],
  ['border-radius:6px', "the blocking card's 20x20 indicator geometry"],
  ['word-spacing:-2px', "the blocking card's pager type ramp"],
]) {
  assert.ok(sheet.includes(declaration), `the stylesheet must carry ${why} (${declaration})`)
}
// The countdown is the one addition, and it must ride the same ramp as `.progress`.
assert.match(sheet, /\.\w+_countdown\b/, 'the countdown class must be styled')
assert.match(sheet, /\[data-state='settled'\]|\[data-state=settled\]/, 'the settled state must be styled')
// A literal colour here means the card stopped following the theme tokens the
// blocking card uses. `#0000` is excluded because lightningcss minifies
// `transparent` to it — a keyword, not a hardcoded palette value.
assert.doesNotMatch(sheet.replaceAll('#0000', ''), /#[0-9a-fA-F]{3,8}\b/, 'no literal colours may enter the stylesheet')
assert.doesNotMatch(sheet, /prefers-color-scheme|\[data-theme/, 'the stylesheet must not select on theme')
// The class map must be real: every class the DOM carries has to resolve to a
// scoped name, or the rules would address nothing.
const cardEl = dockHost.querySelector('[data-dsh-question-card]')
for (const className of cardEl.classList) {
  assert.match(className, /^\w+_\w+$/, `the card's class "${className}" must be a scoped CSS-module name`)
}

// Click admission is synchronous even before React repaints the busy state.
const sent = []
let settle
const send = text => { sent.push(text); return new Promise(resolve => { settle = resolve }) }
mount(toolview.component, { sessionId: 'answer-click', callId: 'c-click', block: { argsRaw: JSON.stringify({ questions: [{ id: 'q', question: '选哪个？', options: [{ label: '首选 (Recommended)' }, { label: '次选' }] }] }) } })
const clickDock = mount(dock.component, { t: translate, sessionId: 'answer-click', send })
const firstOption = clickDock.querySelector('[data-dsh-question-option]')
act(() => { firstOption.click(); firstOption.click() })
assert.equal(sent.length, 1, 'one single-choice click sends once, including same-tick double clicks')
assert.match(sent[0], /首选 \(Recommended\)/, 'the original label reaches the model')
assert.ok(clickDock.querySelector('[data-dsh-question-card]'), 'unaccepted answers stay open')
await act(async () => { settle() })
assert.equal(clickDock.querySelector('[data-dsh-question-card]'), null, 'the card closes after acceptance')

let attempts = 0
mount(toolview.component, { sessionId: 'answer-retry', callId: 'c-retry', block: { argsRaw: JSON.stringify({ questions: [{ id: 'q', question: '选哪个？', options: [{ label: '首选' }] }] }) } })
const retryDock = mount(dock.component, { t: translate, sessionId: 'answer-retry', send: async () => { if (++attempts === 1) throw new Error('发送失败') } })
await act(async () => { retryDock.querySelector('[data-dsh-question-option]').click() })
assert.match(retryDock.textContent, /发送失败/, 'failure is visible and the question stays answerable')
assert.equal(retryDock.querySelector('[data-dsh-question-option]').getAttribute('data-selected'), 'true', 'failure retains the answer')
await act(async () => { retryDock.querySelector('[data-prim="Button"]:last-child').click() })
assert.equal(attempts, 2, 'the retained answer can be retried')

mount(toolview.component, { sessionId: 'answer-multi', callId: 'c-multi', block: { argsRaw: JSON.stringify({ questions: [{ id: 'q', question: '选哪些？', options: [{ label: '一' }, { label: '二' }], multi_select: true }] }) } })
const multiSent = []
const multiDock = mount(dock.component, { t: translate, sessionId: 'answer-multi', send: async text => { multiSent.push(text) } })
act(() => { multiDock.querySelectorAll('[data-dsh-question-option]')[0].click() })
act(() => { multiDock.querySelectorAll('[data-dsh-question-option]')[1].click() })
assert.equal(multiSent.length, 0, 'multi-select waits for the explicit send action')
await act(async () => { multiDock.querySelector('[data-prim="Button"]:last-child').click() })
assert.match(multiSent[0], /"selected":\["一","二"\]/)

const answerView = regs.find(reg => reg.options.key === 'user')
assert.ok(answerView.options.priority < 0, 'answer presentation must rank ahead of the host default')
const copy = { answered: '已回答', answer: '回答', supplement: '补充', copy: '复制', copied: '已复制', references: '引用：{labels}' }
const t = (key, values) => Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), copy[key] ?? key)
const imageCalls = []
const propsFor = (text, content = []) => ({ node: { data: { content: [{ type: 'text', text }, ...content], time: 1_700_000_000_000, referenceLabels: ['角色'], skillNames: ['test'] } }, t,
  renderMessageImages: owner => { imageCalls.push(owner); return React.createElement('span', { 'data-image': '' }, 'image') }, openFile() {}, openSkill() {} })
const receipt = mount(answerView.component, propsFor(sent[0]))
assert.ok(receipt.querySelector('[data-dsh-answer-message]'))
assert.match(receipt.textContent, /选哪个？/)
assert.match(receipt.textContent, /首选/)
assert.doesNotMatch(receipt.textContent, /questionId|selected|之前的工作|Recommended/)
await act(async () => { receipt.querySelector('[aria-label="复制"]').click() })
assert.equal(clipboard.at(-1), sent[0], 'copy preserves the complete original payload')
assert.ok(receipt.querySelector('[aria-label="已复制"]'))
assert.equal(receipt.querySelector('time').dateTime, '2023-11-14T22:13:20.000Z')
const customText = '对非阻塞问题「今天做什么？」的回答：\n' + JSON.stringify({ questionId: 'c:q', selected: [], custom: '看今天的消息\n看看文档' }) + '\n请把它作为后续建议或决策的输入；之前的工作不需要重做。'
const customReceipt = mount(answerView.component, propsFor(customText))
assert.match(customReceipt.textContent, /看今天的消息\n看看文档/)
const ordinary = mount(answerView.component, propsFor('普通消息 @角色 /test', [{ type: 'image', attachment: { id: 'image-1' } }, { type: 'file', attachment: { name: 'report.txt', bytes: 20 } }]))
assert.equal(ordinary.querySelector('[data-dsh-answer-message]'), null)
assert.match(ordinary.textContent, /普通消息 @角色 \/test/)
assert.match(ordinary.textContent, /report.txt/)
assert.match(ordinary.textContent, /引用：角色/)
assert.equal(imageCalls.length, 1, 'ordinary attachments use the public authorized gallery')
const malformed = mount(answerView.component, propsFor(customText.replace('"selected":[]', '"selected":null')))
assert.ok(malformed.textContent.includes('"selected":null'), 'malformed messages keep their original text')
const fallback = React.createElement('span', { 'data-original-message': '' }, '调用方原始展示')
const factoryReceipt = mount(ctx.factory.component, { ...propsFor(customText), fallback })
assert.ok(factoryReceipt.querySelector('[data-dsh-answer-message]'), 'the shared factory renders answers under another keyed renderer')
const factoryOrdinary = mount(ctx.factory.component, { ...propsFor('普通消息'), fallback })
assert.equal(factoryOrdinary.textContent, '调用方原始展示', 'an unmatched message retains its caller presentation')
console.log('render smoke: answer admission, receipt, legacy messages and ordinary messages passed')
console.log(`  countdown repainted ${firstRead} -> ..., and read ${settledRead} once the window lapsed`)
console.log('  a lapsed window kept the question answerable; no render crash was swallowed')
console.log(`  stylesheet injected: ${String(styles.length)} tag(s), ${String(sheet.length)} bytes of scoped CSS`)
