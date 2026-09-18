import { build } from 'esbuild'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const moduleId = 'dsh-proactive-questioning'
const clientOutput = resolve(root, 'lib/client.js')

/**
 * Compile `*.module.css` into a class map plus a self-injecting style tag.
 *
 * This mirrors the harness's own client preset (`packages/client/tsdown.client.ts`,
 * plugin `dsh-css-modules-inline`) rather than reimplementing it loosely: the
 * same `[hash]_[local]` pattern, the same `data-plugin-css` tag identity with a
 * `querySelector` guard against double injection, and the same default-exported
 * class map. Matching it matters because the card's stylesheets are transcriptions
 * of the official ones — if the hashing differed the two surfaces would still
 * render, but a future diff against upstream would stop being eyeball-comparable.
 *
 * `lightningcss` is resolved by search, not declared as a dependency: it is a
 * build-time tool for a private plugin, and vendoring a native CSS compiler into
 * it would be the tail wagging the dog. The search order below covers both places
 * this package is built — installed inside the harness workspace (where
 * `pnpm install` hoists it) and checked out alongside it in DSHPlugins, where it
 * only exists in the sibling harness. The failure message names every root it
 * tried, so a new layout is a diagnosable error rather than a mystery.
 */
function cssModulesPlugin() {
  const require = createRequire(import.meta.url)
  const searchRoots = [
    // An explicit override wins: the escape hatch for an unrelated layout.
    process.env.DSH_LIGHTNINGCSS_ROOT,
    // This package, then the workspace it sits in (the in-harness install).
    root,
    resolve(root, '../..'),
    // The sibling harness checkout: `DSHPlugins/packages/<pkg>` -> `CottonProject`.
    process.env.DSH_HARNESS_ROOT,
    resolve(root, '../../../deepseek-harness'),
  ].filter(candidate => typeof candidate === 'string' && candidate !== '')
  let transform
  let resolvedFrom
  for (const paths of searchRoots) {
    // A nonexistent root must be skipped rather than tried: `require.resolve`
    // walks UP from `paths`, so a missing directory would still find a stray
    // copy somewhere above it and report a root that never held one.
    if (!existsSync(paths)) continue
    try {
      ({ transform } = require(require.resolve('lightningcss', { paths: [paths] })))
      resolvedFrom = paths
      break
    } catch { /* try the next root; the error below names them all */ }
  }
  if (transform === undefined) {
    throw new Error(`Could not resolve lightningcss for the CSS-module step. Looked from: ${searchRoots.join(', ')}. Set DSH_LIGHTNINGCSS_ROOT (or DSH_HARNESS_ROOT) to a directory that can see it.`)
  }
  console.log(`  css: lightningcss from ${resolvedFrom ?? root}`)
  const VIRTUAL_PREFIX = '\0dsh-css:'
  const VIRTUAL_SUFFIX = '.mjs'

  return {
    name: 'dsh-css-modules-inline',
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /\.module\.css$/ }, args => ({
        path: VIRTUAL_PREFIX + resolve(args.resolveDir, args.path) + VIRTUAL_SUFFIX,
        namespace: 'dsh-css',
      }))
      pluginBuild.onLoad({ filter: /.*/, namespace: 'dsh-css' }, async (args) => {
        const fileId = args.path.slice(VIRTUAL_PREFIX.length, -VIRTUAL_SUFFIX.length)
        const source = await readFile(fileId)
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classMap = {}
        for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
        const tagId = `${moduleId}/${basename(fileId)}`
        const contents = [
          `const css = ${JSON.stringify(code.toString())};`,
          `const tagId = ${JSON.stringify(tagId)};`,
          'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
          '  const tag = document.createElement(\'style\');',
          `  tag.dataset.plugin = ${JSON.stringify(moduleId)};`,
          '  tag.dataset.pluginCss = tagId;',
          '  tag.textContent = css;',
          '  document.head.appendChild(tag);',
          '}',
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n')
        return { contents, loader: 'js' }
      })
    },
  }
}

const client = await build({
  entryPoints: [resolve(root, 'src/client/index.ts')], bundle: true, format: 'cjs', platform: 'browser',
  target: 'es2022', write: false, sourcemap: false, legalComments: 'none',
  // Match the TypeScript `react-jsx` transform: without this esbuild defaults to the classic
  // runtime and emits bare `React.createElement`, which the bundle never binds (it imports only
  // named hooks) — every slot component then dies with `ReferenceError: React is not defined`.
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/*'], logLevel: 'silent',
  plugins: [cssModulesPlugin()],
})
const clientBundle = client.outputFiles.find(file => file.path.endsWith('.js')) ?? client.outputFiles[0]
if (clientBundle === undefined) throw new Error('Proactive-questioning client did not produce JavaScript.')
await mkdir(dirname(clientOutput), { recursive: true })
await writeFile(clientOutput, `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(moduleId)},\n  factory: (require) => {\n    var module = { exports: {} }\n    var exports = module.exports\n${clientBundle.text}\n    return module.exports\n  },\n})\n`)
await build({
  entryPoints: [resolve(root, 'src/index.ts')], bundle: true, format: 'esm', platform: 'node', target: 'node22',
  outfile: resolve(root, 'lib/index.mjs'), external: ['@deepseek-ai/*'], legalComments: 'none', logLevel: 'silent',
})
console.log(`Built ${clientOutput}`)
