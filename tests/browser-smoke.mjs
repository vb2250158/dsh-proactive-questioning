/**
 * Load the live Web app in a real Chromium and report whether the plugin's
 * client bundle survives module load.
 *
 * The defect this checks for is invisible from the server side: the bundle
 * served fine, the boot manifest listed it, and the only symptom was a
 * `ReferenceError` raised while React rendered the slot entry — swallowed by
 * the slot boundary, so the page looked merely empty. Asserting the module
 * registered and that React produced no render error is what distinguishes
 * "shipped" from "works".
 */
import { createRequire } from 'node:module'

const [, , baseUrl, executablePath, playwrightEntry] = process.argv
// playwright-core and a Chromium build are host tools, not plugin
// dependencies: resolve them from wherever this machine keeps them rather
// than adding a test-only dependency to a published package.
const require = createRequire(import.meta.url)
const { chromium } = require(playwrightEntry ?? 'playwright-core')
const problems = []
const notices = []

const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage()

page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))
page.on('console', message => {
  if (message.type() === 'error') problems.push(`console.error: ${message.text()}`)
  else if (message.type() === 'warning') notices.push(message.text())
})

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
await page.waitForTimeout(8_000)

const probe = await page.evaluate(() => {
  const loader = globalThis.window?.__ModuleLoader__
  const modules = loader?.modules ?? loader?.registry ?? undefined
  let loadedIds = []
  try {
    loadedIds = [...(loader?.loaded?.keys?.() ?? [])]
  } catch { /* the loader's internals are not ours to depend on */ }
  return {
    hasLoader: loader !== undefined,
    reactIsDefined: typeof globalThis.React !== 'undefined',
    jsxRuntimeReachable: (() => {
      try { return typeof loader?.require?.('react/jsx-runtime')?.jsx === 'function' } catch { return false }
    })(),
    loadedIds: loadedIds.filter(id => String(id).includes('proactive')),
    rootChildren: document.querySelector('#root')?.childElementCount ?? -1,
    title: document.title,
  }
})

const reactive = problems.filter(text => /React is not defined|slot entry crashed/i.test(text))
console.log(JSON.stringify({
  probe,
  reactNotDefined: reactive,
  otherProblems: problems.filter(text => !reactive.includes(text)),
  notices: notices.slice(0, 5),
}, null, 2))

await browser.close()
process.exit(reactive.length === 0 ? 0 : 1)
