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
import { readFileSync, readdirSync, mkdirSync } from 'node:fs'
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
TOKENS.dark['--dsw-specific-bubble'] = '#17385e'
TOKENS.light['--dsw-specific-bubble'] = '#edf4ff'
TOKENS.dark['--dsw-radius-xl'] = TOKENS.light['--dsw-radius-xl'] = '20px'
TOKENS.custom = { ...TOKENS.dark, '--dsw-alias-bg-base': '#071a2b', '--dsw-alias-bg-layer-1': '#102841', '--dsw-specific-bubble': '#17385e', '--dsw-alias-label-primary': '#e7f3ff', '--dsw-alias-label-secondary': '#bcd1e8' }
mkdirSync(outDir, { recursive: true })

const tokens = TOKENS[theme]
const page = `
<!doctype html>
<html><head><meta charset="utf-8"><style>
  :root { ${Object.entries(tokens).map(([k, v]) => `${k}: ${v};`).join('\n          ')} }
  html, body { margin: 0; }
  body {
    background: var(--dsw-alias-bg-base);
    font-family: "Microsoft YaHei", "Segoe UI", system-ui, sans-serif;
    padding: 24px;
  }
  #stage { width: 100%; max-width: 100%; }
  [data-prim="Button"] { font: inherit; padding: 8px 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; color: var(--dsw-alias-label-primary); background: transparent; }
  [data-variant="primary"] { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-label-primary-foreground); }
  [data-prim="Button"]:disabled { opacity: .4; }
  [data-prim="Tag"] { display: inline-flex; align-items: center; border-radius: 999px; padding: 1px 8px; font-size: 11px; line-height: 17px; font-weight: 500; white-space: nowrap; }
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
            if (key === 'projectUserText') return text => text
            if (key === 'writeClipboard') return async text => { window.copiedText = text; return true }
            if (key === 'fileExtension') return path => path.split('.').at(-1)
            if (key === 'fileSizeText') return bytes => bytes + ' B'
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
            const Stub = props => { const { variant, children, ...rest } = props; return window.React.createElement(key === 'Button' ? 'button' : 'span', { ...rest, 'data-prim': key, 'data-variant': variant }, children) }
            return Stub
          }, has: () => true })
        }
        throw new Error('unbound module: ' + specifier)
      }) }
    },
  };
` })
await live.addScriptTag({ content: bundle })

if (expand === 'answers') {
  await live.evaluate(() => {
    const regs = []
    const locales = {}
    const ctx = { effect: fn => fn(), locale: { register: (name, value) => { locales[name] = value.zh; return () => {} } }, sessions: {}, slots: {
      inject: (_name, setup) => setup(), register: (options, component) => { regs.push({ options, component }); return () => {} },
    } }
    window.__dshLoaded.exports.apply(ctx)
    const renderer = regs.find(entry => entry.options.key === 'user').component
    const t = key => locales['proactive-answer'][key] ?? key
    const suffix = '\n请把它作为后续建议或决策的输入；之前的工作不需要重做。'
    const answer = (question, selected, custom) => '对非阻塞问题「' + question + '」的回答：\n' + JSON.stringify({ questionId: 'preview:q', selected, custom }) + suffix
    const samples = [
      answer('这次要做哪一个新流程？', [], '你看群消息，今天的，看了文档如果还有问题则后端'),
      answer('需要验证哪些场景？', ['明暗主题 (Recommended)', '手机布局'], '保留之前的工作进度。'),
      '普通消息与 @角色 引用保持可读。',
    ]
    const stage = document.getElementById('stage')
    stage.style.display = 'grid'
    stage.style.gap = '24px'
    for (const text of samples) {
      const box = document.createElement('div')
      stage.appendChild(box)
      ReactDOM.createRoot(box).render(React.createElement(renderer, { t, node: { data: { content: [{ type: 'text', text }], time: 1_700_000_000_000 } }, renderMessageImages: () => null, openFile() {}, openSkill() {} }))
    }
  })
  await live.locator('[data-dsh-answer-message]').first().waitFor()
  if (await live.locator('[data-dsh-answer-message]').count() !== 2) throw new Error('both answer variants must render')
  const receipts = await live.locator('[data-dsh-answer-message]').allTextContents()
  if (receipts.some(text => /questionId|selected|之前的工作不需要重做/.test(text))) throw new Error('receipt leaked protocol text')
  await live.getByRole('button', { name: '复制', exact: true }).first().click()
  if (!await live.evaluate(() => window.copiedText.includes('questionId'))) throw new Error('copy lost original payload')
  await live.locator('#stage').screenshot({ path: join(outDir, `answer-card-${theme}.png`) })
  await live.setViewportSize({ width: 390, height: 844 })
  if (await live.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('receipt overflow on mobile')
  await live.locator('#stage').screenshot({ path: join(outDir, `answer-card-${theme}-mobile.png`) })
  if (problems.length) throw new Error(problems.join(' | '))
  console.log('PASS: answer cards, copy and narrow-screen layout: ' + theme)
  await browser.close()
  process.exit(0)
}

const rendered = await live.evaluate(({ questionsJson, themeName, expand }) => {
  const React = window.React
  const loaded = window.__dshLoaded
  const calls = []
  const ctx = {
    effect: fn => (typeof fn === 'function' ? fn() : undefined),
    sessions: {},
    locale: { register: () => () => {} },
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
      if (expand === 'aged') { const now = Date.now(); Date.now = () => now + 130000 }
      ReactDOM.createRoot(dockBox).render(React.createElement(dock.component, { sessionId: 's1', t: key => ({ send: '发送回答', sending: '发送中…', sent: '已发送' })[key] ?? key, send: async () => undefined }))
      setTimeout(() => {
        // The dock expands its NEWEST question by default. Clicking the older
        // row's 回答 moves the full card onto that one, which is how the
        // single-select variant (ordinal indicators, 推荐 badge, pager) gets its
        // own review. `expand=oldest` therefore means "click 回答 once".
        if (expand === 'oldest') {
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
    { id: 'q1', header: 'UnitInfo · 配置方案', question: '“卡池解锁标注”需要面向谁展示？', options: [
      { label: '仅配置表备注 (recommended)', description: '标明卡池来源或解锁条件，供配置维护时查看。' }, { label: '玩家可见提示', description: '在游戏内展示解锁条件，需要确定页面和提示内容。' }, { label: '两者都需要', description: '同时完善配置备注与玩家界面的提示。' },
    ] },
    { id: 'q2', question: '首批需要覆盖哪些内容？', options: [{ label: '已有单位' }, { label: '新增单位' }], multi_select: true },
  ]),
  themeName: theme,
  expand,
})

if (await live.locator('[data-dsh-question-card]').count() !== 1) throw new Error('initial question must use the padded card, including aged questions')
console.log('style tags injected by the bundle:', rendered.styleTags)
console.log('console errors:', problems.length === 0 ? 'none' : problems.join(' | '))

if (expand === 'oldest') await live.getByRole('button', { name: '下一题', exact: true }).click()
await live.getByRole('checkbox').first().click()
if (await live.getByRole('checkbox').first().getAttribute('aria-checked') !== 'true') throw new Error('selection failed')
await live.getByRole('button', { name: '上一题', exact: true }).click()
if (await live.getByRole('radio').count() !== 3) throw new Error('previous question failed')
await live.getByRole('radio').first().click()
await live.getByRole('button', { name: '收起草稿（问题仍保留，可随时回来回答）' }).click()
if (await live.locator('[data-dsh-question-card]').count() !== 0) throw new Error('collapse failed')
await live.getByRole('button', { name: /需要你的意见/ }).click()
await live.getByRole('textbox').fill('可以补充说明')
if (await live.getByRole('radio').first().getAttribute('aria-checked') !== 'false') throw new Error('custom answer exclusivity failed')
await live.getByRole('button', { name: '下一题', exact: true }).click()
if (await live.getByRole('checkbox').first().getAttribute('aria-checked') !== 'true') throw new Error('navigation lost draft')
await live.getByRole('button', { name: '上一题', exact: true }).click()
if (process.env.RABI_QUESTION_SOURCE) {
  const voiceSource = readFileSync(process.env.RABI_QUESTION_SOURCE, 'utf8').replace("import * as React from 'react'", 'const React = window.React')
  await live.addScriptTag({ type: 'module', content: voiceSource + '\nwindow.attachQuestionVoice = attachRabiQuestionExtras; window.questionVoiceCopy = rabiQuestionLocales.zh;' })
  await live.waitForFunction(() => typeof window.attachQuestionVoice === 'function')
  await live.evaluate(() => window.attachQuestionVoice(document.getElementById('stage'), { sessionId: 'test', t: key => window.questionVoiceCopy[key] }))
}
async function checkVoiceRow() {
  if (!process.env.RABI_QUESTION_SOURCE) return
  const mic = await live.locator('[data-rabi-question-mic]').boundingBox()
  const toggle = await live.getByRole('switch', { name: '自动语音输入' }).boundingBox()
  if (!mic || !toggle || Math.abs(mic.y + mic.height / 2 - toggle.y - toggle.height / 2) > 2 || mic.x < toggle.x) throw new Error('automatic voice toggle must sit beside the microphone')
  console.log('PASS: automatic voice toggle and microphone share a row')
}
await checkVoiceRow()
const insets = await live.locator('[data-dsh-question-card]').evaluate(card => {
  const box = card.getBoundingClientRect()
  const title = card.querySelector('[role="heading"]').getBoundingClientRect()
  const option = card.querySelector('[data-dsh-question-option]').getBoundingClientRect()
  if (option.height > 58) throw new Error('two-line option is too tall: ' + option.height)
  const bar = card.parentElement.previousElementSibling.getBoundingClientRect()
  if (box.top - bar.bottom > 1) throw new Error('extra gap between header bar and question')
  return { title: title.left - box.left, left: option.left - box.left, right: box.right - option.right }
})
if (Object.values(insets).some(value => value < 23)) throw new Error('question or options touch the edge: ' + JSON.stringify(insets))
if (expand === 'aged' && await live.locator('[data-dsh-question-countdown]').textContent() !== '已保留') throw new Error('aged fixture not exercised')
console.log('question/option insets:', insets)
const suffix = expand === 'newest' ? '' : `-${expand}`
const out = join(outDir, `question-card-${theme}${suffix}.png`)
await live.locator('#stage').screenshot({ path: out })
console.log('wrote', out)
await live.setViewportSize({ width: 390, height: 844 })
await checkVoiceRow()
const overflow = await live.evaluate(() => document.documentElement.scrollWidth > innerWidth)
if (overflow) throw new Error('mobile horizontal overflow')
await live.locator('#stage').screenshot({ path: join(outDir, `question-card-${theme}-mobile.png`) })
if (problems.length) throw new Error(problems.join(' | '))
console.log('PASS: selection, pager, collapse, input, mobile overflow')
await browser.close()
