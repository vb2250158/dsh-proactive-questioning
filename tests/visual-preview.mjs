/**
 * Render the built card to a screenshot so the visual result can be reviewed
 * without a running app.
 *
 * Mounts the BUILT bundle through real React in a real Chromium, with the
 * stylesheet injected by the bundle itself. Theme tokens are supplied by a small
 * shim below, derived from the real theme's values, because the token sheet
 * lives in the app shell rather than in the plugin.
 *
 *   node tests/visual-preview.mjs <chromium> <playwright-entry> <out-dir> [theme]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [, , executablePath, playwrightEntry, outDir, theme = 'dark', expand = 'newest'] = process.argv
const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { chromium } = require(playwrightEntry ?? 'playwright-core')

const pnpmDir = 'C:/Data/CottonProject/deepseek-harness/node_modules/.pnpm'
const bundle = readFileSync(join(here, '..', 'lib/client.js'), 'utf8')

// The two palettes the app ships. Only the tokens this card consumes are listed;
// names are the app's own, values are its published light/dark pairs.
const TOKENS = {
  dark: {
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
  },
  light: {
    '--dsw-alias-label-primary': '#1f2023',
    '--dsw-alias-label-primary-foreground': '#ffffff',
    '--dsw-alias-label-secondary': '#5a5c63',
    '--dsw-alias-label-tertiary': '#84868e',
    '--dsw-alias-label-dimmed': '#a8aab1',
    '--dsw-alias-label-caption': '#96989f',
    '--dsw-alias-border-l1': '#e4e5e9',
    '--dsw-alias-border-l2': '#d5d7dd',
    '--dsw-alias-border-l4': '#c3c5cc',
    '--dsw-alias-border-l2-darkmode-thin': '#d5d7dd',
    '--dsw-alias-bg-base': '#ffffff',
    '--dsw-alias-bg-layer-1': '#f7f8fa',
    '--dsw-alias-bg-overlay': '#eef0f3',
    '--dsw-alias-bg-module-platform': '#f2f3f6',
    '--dsw-alias-interactive-bg-hover': '#eef0f3',
    '--dsw-specific-input-major': '#ffffff',
    '--dsw-specific-tip': '#f7f8fa',
    '--dsw-specific-sidebar-nav-item-active-accent': '#e3ecff',
    '--dsw-alias-button-info-fill': '#1f5fd6',
    '--dsw-alias-state-error-primary': '#d92d20',
    '--dsw-alias-state-business-primary': '#2b6de0',
    '--dsw-alias-scrollbar-bg-l2': '#d5d7dd',
    '--dsw-alias-scrollbar-hover-l2': '#c3c5cc',
    '--dsw-elevation-panel': '0 8px 24px rgba(16,24,40,.12)',
  },
}

const tokens = TOKENS[theme]
const page = `
<!doctype html>
<html><head><meta charset="utf-8"><style>
  :root { ${Object.entries(tokens).map(([k, v]) => `${k}: ${v};`).join('\n          ')} }
  html, body { margin: 0; }
  body {
    background: ${theme === 'dark' ? 'var(--dsw-alias-bg-base)' : '#f2f3f6'};
    font-family: "Microsoft YaHei", "Segoe UI", system-ui, sans-serif;
    padding: 24px;
  }
  #stage { width: 720px; max-width: 100%; }
</style></head>
<body><div id="stage"></div></body></html>`

const browser = await chromium.launch({ executablePath, headless: true })
const context = await browser.newContext({ viewport: { width: 820, height: 760 }, deviceScaleFactor: 2 })
const live = await context.newPage()
live.on('pageerror', error => { console.error('pageerror:', error.message) })
await live.setContent(page)

const problems = []
live.on('console', message => { if (message.type() === 'error') problems.push(message.text()) })

// Load order matters: React and the JSX runtime must exist before the bundle's
// factory resolves them, and the loader stub must exist before the bundle runs.
// The UMD files are addressed directly: React's `exports` map does not expose
// `./umd/*`, and a `resolve()` call on that subpath is rejected before it can
// find the file.
const reactRoot = join(pnpmDir, readdirSync(pnpmDir).find(name => name.startsWith('react@18')), 'node_modules/react')
const reactDomRoot = join(pnpmDir, readdirSync(pnpmDir).find(name => name.startsWith('react-dom@18')), 'node_modules/react-dom')
const reactPath = join(reactRoot, 'umd/react.development.js')
const reactDomPath = join(reactDomRoot, 'umd/react-dom.development.js')
await live.addScriptTag({ path: reactPath })
await live.addScriptTag({ path: reactDomPath })
await live.addScriptTag({ content: `
  // The automatic runtime hands multi-child elements to \`jsxs\` as a plain
  // ARRAY of children, and the real runtime marks that array as static so the
  // reconciler never asks for keys on it. \`createElement\` cannot express that:
  // it treats an array child as a dynamic list and warns on every keyless
  // element — which is exactly what every \`{cond && <el/>}\` slot becomes.
  // Keying the array here reproduces the real runtime's observable behaviour
  // (no warning, same tree) and keeps the harness from reporting a problem the
  // product does not have. This shim is test-only; it never ships.
  const staticChildren = children => Array.isArray(children)
    ? children.map((child, index) => child === null || typeof child !== 'object' || window.React.isValidElement(child) === false
        ? child
        : child.key === null || child.key === undefined ? window.React.cloneElement(child, { key: 's' + index }) : child)
    : children;
  window.__jsxRuntime = {
    jsx: (type, props, key) => window.React.createElement(type, { ...props, key },
      staticChildren(props?.children)),
    jsxs: (type, props, key) => window.React.createElement(type, { ...props, key },
      staticChildren(props?.children)),
    Fragment: window.React.Fragment,
  };
  window.__ModuleLoader__ = {
    load({ id, factory }) {
      window.__dshLoaded = { id, exports: factory(specifier => {
        if (specifier === 'react') return window.React
        if (specifier === 'react/jsx-runtime') return window.__jsxRuntime
        if (specifier === '@deepseek-ai/dsh-client-ui-primitives') {
          // Icons must occupy their real box or the screenshot misrepresents the
          // layout: the card sizes its header action group and its indicator
          // seats from these. A glyph placeholder keeps the geometry honest while
          // the harness stays independent of the primitive package's internals.
          const ICON = /^Icon/;
          return new Proxy({}, { get: (_t, key) => {
            if (typeof key !== 'string' || !/^[A-Z]/.test(key)) return undefined
            if (ICON.test(key)) {
              const Glyph = props => {
                const size = typeof props?.size === 'number' ? props.size : 16
                return window.React.createElement('span', {
                  'data-prim': key,
                  style: {
                    display: 'inline-block', width: size + 'px', height: size + 'px',
                    lineHeight: size + 'px', fontSize: size + 'px', textAlign: 'center',
                    color: 'currentColor',
                  },
                }, '\\u25CF')
              }
              return Glyph
            }
            const Stub = props => window.React.createElement('span', { 'data-prim': key }, props?.children ?? null)
            return Stub
          }, has: () => true })
        }
        throw new Error('unbound module: ' + specifier)
      }) }
    },
  };
` })
await live.addScriptTag({ content: bundle })

const rendered = await live.evaluate(({ questionsJson, themeName, expand }) => {
  const React = window.React
  const loaded = window.__dshLoaded
  const calls = []
  const ctx = {
    effect: fn => (typeof fn === 'function' ? fn() : undefined),
    sessions: {},
    slots: {
      inject: (name, setup) => { calls.push({ name, setup }); return () => {} },
      register: (options, component) => { (ctx.regs ??= []).push({ slot: ctx.open, options, component }); return () => {} },
    },
  }
  loaded.exports.apply(ctx)
  const regs = []
  ctx.slots.register = (options, component) => { regs.push({ slot: ctx.open, options, component }); return () => {} }
  for (const call of calls) { ctx.open = call.name; call.setup({ name: call.name, register: () => {} }) }

  const toolview = regs.find(r => r.options.key === 'queue_user_question')
  const dock = regs.find(r => r.options.id === 'proactive-questioning-dock')
  const stage = document.getElementById('stage')
  const rowBox = document.createElement('div')
  const dockBox = document.createElement('div')
  dockBox.style.marginTop = '18px'
  stage.append(rowBox, dockBox)

  const argsRaw = JSON.stringify({ questions: JSON.parse(questionsJson) })
  ReactDOM.createRoot(rowBox).render(React.createElement(toolview.component, {
    sessionId: 's1', callId: 'c1', block: { kind: 'result', call: { argsRaw } },
  }))
  return new Promise(resolve => {
    setTimeout(() => {
      ReactDOM.createRoot(dockBox).render(React.createElement(dock.component, { sessionId: 's1', send: async () => undefined }))
      setTimeout(() => {
        // The dock expands its NEWEST question by default. Clicking the older
        // row's 回答 moves the full card onto that one, which is how the
        // single-select variant (ordinal indicators, 推荐 badge, pager) gets its
        // own review. `expand=oldest` therefore means "click 回答 once".
        if (expand !== 'newest') {
          const open = [...document.querySelectorAll('[data-dsh-proactive-questions] button')]
            .find(button => button.textContent === '回答')
          open?.click()
        }
        setTimeout(() => resolve({ styleTags: document.querySelectorAll('style[data-plugin-css]').length }), 300)
      }, 400)
    }, 300)
  })
}, {
  questionsJson: JSON.stringify([
    { id: 'q1', header: '午餐', question: '午餐吃面还是饭？', options: [
      { label: '面 (recommended)', description: '更快' }, { label: '饭' },
    ] },
    { id: 'q2', question: '要加辣吗？', options: [{ label: '加' }, { label: '不加' }], multi_select: true },
  ]),
  themeName: theme,
  expand,
})

console.log('style tags injected by the bundle:', rendered.styleTags)
console.log('console errors:', problems.length === 0 ? 'none' : problems.join(' | '))

const suffix = expand === 'newest' ? '' : `-${expand}`
const out = join(outDir, `question-card-${theme}${suffix}.png`)
await live.locator('#stage').screenshot({ path: out })
console.log('wrote', out)
await browser.close()
