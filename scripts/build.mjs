import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const moduleId = 'dsh-proactive-questioning'
const clientOutput = resolve(root, 'lib/client.js')

const client = await build({
  entryPoints: [resolve(root, 'src/client/index.ts')], bundle: true, format: 'cjs', platform: 'browser',
  target: 'es2022', write: false, sourcemap: false, legalComments: 'none',
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/*'], logLevel: 'silent',
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
