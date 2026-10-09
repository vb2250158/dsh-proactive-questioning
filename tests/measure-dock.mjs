/**
 * Measure the dock's rendered geometry in the real conversation column.
 *
 * The screenshot harness renders at a fixed 720px stage, which is the *floor*
 * of the chat column (`clamp(680px, column * 0.64, 920px)`), so it cannot tell
 * whether the card is oversized on a normal-width window. This script measures
 * the built bundle at several real column widths and prints the boxes, so the
 * size question is answered with numbers instead of an impression.
 *
 *   DSH_SOURCE_ROOT=<source> node tests/measure-dock.mjs <chromium> <playwright-entry>
 */
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const [, , executablePath, playwrightEntry] = process.argv
const theme = 'dark'
const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { chromium } = require(playwrightEntry ?? 'playwright-core')

if (!process.env.DSH_SOURCE_ROOT) throw new Error('DSH_SOURCE_ROOT must name the DSH source checkout with React 18 installed.')
const pnpmDir = join(resolve(process.env.DSH_SOURCE_ROOT), 'node_modules', '.pnpm')
const reactPackages = readdirSync(pnpmDir)
const react = reactPackages.find(name => name.startsWith('react@18'))
const reactDom = reactPackages.find(name => name.startsWith('react-dom@18'))
if (!react || !reactDom) throw new Error('The geometry fixture requires React 18 and React DOM 18 UMD builds.')
const bundle = readFileSync(join(here, '..', 'lib/client.js'), 'utf8')

// The tokens this card consumes. Values are the app's published dark pair.
const TOKENS = {
  '--dsw-alias-label-primary': '#e8e8ea',
  '--dsw-alias-label-primary-foreground': '#16171b',
  '--dsw-alias-label-secondary': '#a9aab1',
  '--dsw-alias-label-tertiary': '#7d7f88',
  '--dsw-alias-label-dimmed': '#5c5e66',
  '--dsw-alias-label-caption': '#6b6d76',
  '--dsw-alias-border-l1': '#2a2c33',
  '--dsw-alias-border-l2': '#3a3d45',
  '--dsw-alias-border-l4': '#4a4d56',
  '--dsw-alias-border-l2-darkmode-thin': '#3a3d45',
  '--dsw-alias-bg-base': '#16171b',
  '--dsw-alias-bg-layer-1': '#1c1e23',
  '--dsw-alias-bg-overlay': '#26282f',
  '--dsw-alias-bg-module-platform': '#1f2127',
  '--dsw-alias-interactive-bg-hover': '#282b33',
  '--dsw-specific-input-major': '#1f2127',
  '--dsw-specific-tip': '#1a1c21',
  '--dsw-specific-sidebar-nav-item-active-accent': '#2a3550',
  '--dsw-alias-button-info-fill': '#8ab4ff',
  '--dsw-alias-state-error-primary': '#ff6b6b',
  '--dsw-alias-state-business-primary': '#5b8def',
  '--dsw-alias-scrollbar-bg-l2': '#3a3d45',
  '--dsw-alias-scrollbar-hover-l2': '#4a4d56',
  '--dsw-elevation-panel': '0 8px 24px rgba(0,0,0,.45)',
}

const browser = await chromium.launch({ executablePath, headless: true })
try {
const page = await browser.newPage({ viewport: { width: 900, height: 800 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })

const tokenCss = Object.entries(TOKENS).map(([k, v]) => `${k}: ${v};`).join('\n')
/** The real clamp from ConversationRoot.module.css, evaluated in JS so each
 *  measured width gets a concrete px value rather than an unresolvable var. */
const chatContentWidth = column => Math.min(920, Math.max(680, column * 0.64))

await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
  :root { ${tokenCss} }
  html, body { margin: 0; }
  body { background: #16171b; font-family: "Microsoft YaHei", "Segoe UI", system-ui, sans-serif; }
  .column { box-sizing: border-box; padding: 0 16px; }
  .seat { padding: 6px 16px 10px; }
  /* The composer card the dock shares its seat with, drawn only to give the
     measurement a seat of the same width as the real one. */
  .composer { height: 44px; border-radius: 12px; background: #1f2127; }
</style></head><body></body></html>`)

await page.addScriptTag({ path: join(pnpmDir, react, 'node_modules/react/umd/react.development.js') })
await page.addScriptTag({ path: join(pnpmDir, reactDom, 'node_modules/react-dom/umd/react-dom.development.js') })
await page.addScriptTag({ content: `
  const staticChildren = children => Array.isArray(children) ? children.map((c, i) =>
    c === null || typeof c !== 'object' || window.React.isValidElement(c) === false ? c
      : (c.key === null || c.key === undefined ? window.React.cloneElement(c, { key: 's' + i }) : c)) : children;
  window.__jsxRuntime = {
    jsx: (t, p, k) => window.React.createElement(t, { ...p, key: k }, staticChildren(p?.children)),
    jsxs: (t, p, k) => window.React.createElement(t, { ...p, key: k }, staticChildren(p?.children)),
    Fragment: window.React.Fragment,
  };
  window.__ModuleLoader__ = { load({ factory }) {
    window.__dshLoaded = { exports: factory(specifier => {
      if (specifier === 'react') return window.React
      if (specifier === 'react/jsx-runtime') return window.__jsxRuntime
      if (specifier === '@deepseek-ai/dsh-client-ui-primitives') {
        return new Proxy({}, { get: (_t, key) => {
          if (typeof key !== 'string' || !/^[A-Z]/.test(key)) return undefined
          if (/^Icon/.test(key)) return props => {
            const size = typeof props?.size === 'number' ? props.size : 16
            return window.React.createElement('span', { style: {
              display: 'inline-block', width: size + 'px', height: size + 'px',
              lineHeight: size + 'px', fontSize: size + 'px', textAlign: 'center', color: 'currentColor',
            } }, '\\u25CF')
          }
          return props => window.React.createElement('span', null, props?.children ?? null)
        }, has: () => true })
      }
      throw new Error('unbound module: ' + specifier)
    }) } }
  };` })
await page.addScriptTag({ content: bundle })

const results = await page.evaluate(async ({ themeName }) => {
  const React = window.React
  const ReactDOM = window.ReactDOM
  const loaded = window.__dshLoaded
  const calls = []
  const ctx = {
    effect: fn => (typeof fn === 'function' ? fn() : undefined),
    sessions: {},
    slots: {
      inject: (name, setup) => { calls.push({ name, setup }); return () => {} },
      register: () => () => {},
    },
  }
  loaded.exports.apply(ctx)
  let regs = []
  ctx.slots.register = (options, component) => { regs.push({ slot: ctx.open, options, component }); return () => {} }
  for (const call of calls) { ctx.open = call.name; call.setup({ name: call.name, register: () => {} }) }
  const dock = regs.find(r => r.options.id === 'proactive-questioning-dock')
  const toolview = regs.find(r => r.options.key === 'queue_user_question')

  const questions = [
    { id: 'q1', header: '午餐', question: '午餐吃面还是饭？', options: [
      { label: '面 (recommended)', description: '更快' }, { label: '饭' },
    ] },
    { id: 'q2', question: '要加辣吗？', options: [{ label: '加' }, { label: '不加' }], multi_select: true },
  ]
  // The dock reads the shared store, and the store is fed by the tool row's
  // render. Mounting one tool row first is what makes the dock non-empty —
  // rendering the dock alone yields null boxes, not a small card.
  const seed = document.createElement('div')
  document.body.append(seed)
  ReactDOM.createRoot(seed).render(React.createElement(toolview.component, {
    sessionId: 's1', callId: 'c1', block: { kind: 'result', call: { argsRaw: JSON.stringify({ questions }) } },
  }))
  await new Promise(r => setTimeout(r, 350))

  const out = []
  for (const columnWidth of [1063, 1200, 1438, 1688]) {
    const content = Math.min(920, Math.max(680, columnWidth * 0.64))
    const column = document.createElement('div')
    column.className = 'column'
    column.style.width = columnWidth + 'px'
    column.style.setProperty('--dsh-conversation-column-width', columnWidth + 'px')
    column.style.setProperty('--dsh-chat-content-width', content + 'px')
    column.style.setProperty('--dsh-composer-side-clearance', '16px')
    document.body.append(column)
    const seat = document.createElement('div')
    seat.className = 'seat'
    // Mirror the real seat: the composer sits at the chat content width, and
    // the dock is mounted in the same padded seat beside it.
    seat.style.maxWidth = content + 'px'
    seat.style.margin = '0 auto'
    column.append(seat)
    ReactDOM.createRoot(seat).render(React.createElement(dock.component, {
      sessionId: 's1', send: async () => undefined,
    }))
    await new Promise(r => setTimeout(r, 450))
    const dockEl = seat.querySelector('[data-dsh-proactive-questions]')
    const cardEl = dockEl?.querySelector('[class*="card"]')
    const bodyEl = dockEl?.querySelector('[class*="dockBody"]')
    const chatWidth = getComputedStyle(column).getPropertyValue('--dsh-chat-content-width').trim()
    const r = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) } }
    out.push({
      columnWidth,
      chatContentWidth: chatWidth,
      seatWidth: Math.round(seat.getBoundingClientRect().width),
      contentWidth: content,
      dock: r(dockEl),
      card: r(cardEl),
      dockBody: r(bodyEl),
      cardAspect: cardEl ? (cardEl.getBoundingClientRect().width / cardEl.getBoundingClientRect().height).toFixed(2) : null,
    })
    column.remove()
  }
  seed.remove()
  return out
}, { themeName: theme })

console.log('theme:', theme)
for (const row of results) {
  console.log(`\ncolumn ${row.columnWidth}px  (chat content ${row.chatContentWidth}, seat ${row.seatWidth}px)`)
  console.log('  dock      ', JSON.stringify(row.dock))
  console.log('  card      ', JSON.stringify(row.card))
  console.log('  dockBody  ', JSON.stringify(row.dockBody))
}
console.log('\nconsole/page errors:', errors.length === 0 ? 'none' : errors)
if (errors.length || results.some(row => !row.dock || !row.card || row.card.w <= 0 || row.card.h <= 0)) {
  throw new Error('Question dock geometry fixture did not render without errors.')
}
} finally {
  await browser.close()
}
