/**
 * The card is a transcription of the blocking card's stylesheet, so the property
 * that matters is fidelity: every declaration the two share must be identical,
 * and any that is dropped must be one of the known, justified deviations.
 *
 * This compares against the ORIGINAL file in the harness checkout rather than a
 * frozen list, so a change to the blocking card surfaces here as drift instead
 * of silently diverging. When the original legitimately moves, update BOTH this
 * file's expectations and `src/client/question-card.module.css`.
 *
 * Skips (with a printed note) when the harness checkout is absent, so the suite
 * still passes in a standalone clone.
 */
import { strict as assert } from 'node:assert'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const ORIGINAL = 'C:/Data/CottonProject/deepseek-harness/packages/client/ui-user-questions/src/client/QuestionComposer.module.css'
const COPY = new URL('../src/client/question-card.module.css', import.meta.url)

/**
 * Every `prop:value` pair in a stylesheet, whitespace-collapsed so formatting is
 * not drift. Comments are stripped first: the original's prose is long enough
 * that a naive scan mistakes it for declarations.
 * @param file - stylesheet path or URL.
 * @returns the declaration set.
 */
function declarations(file) {
  const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const set = new Set()
  for (const block of source.matchAll(/\{([^{}]*)\}/g)) {
    for (const decl of block[1].matchAll(/([-a-zA-Z]+)\s*:\s*([^;]+);/g)) {
      set.add(`${decl[1].trim()}:${decl[2].replace(/\s+/g, '')}`)
    }
  }
  return set
}

/**
 * Declarations the two surfaces legitimately do not share, each pinned to the
 * reason it cannot. Presence here IS the justification: an unexplained drop
 * fails the assertion below.
 */
const JUSTIFIED_DEVIATIONS = new Map([
  ['justify-content:center', 'the dock, not this card, owns the composer seat — there is no centering frame'],
  ['padding:6pxcalc(var(--dsh-composer-side-clearance)+16px)10px', 'same frame; the dock supplies the side clearance'],
  ['max-width:var(--dsh-chat-content-width)', 'the dock already constrains width; a second constraint would double-count it'],
  ['max-height:min(60vh,520px)', 'the card shares the seat with the dock bar, so it caps at min(40vh,360px)'],
  ['max-height:none', 'there is no minimized variant here; collapse is the dock bar\'s job'],
  ['padding-bottom:14px', 'belongs to the minimized header, which has no analogue here'],
  ['margin:02px8px', "needs a question `detail` field this plugin's store does not carry"],
])

test('every shared declaration is transcribed verbatim', { skip: !existsSync(ORIGINAL) && 'harness checkout not present' }, () => {
  const original = declarations(ORIGINAL)
  const copy = declarations(COPY)
  const dropped = [...original].filter(decl => !copy.has(decl) && !JUSTIFIED_DEVIATIONS.has(decl))
  assert.deepEqual(dropped, [],
    'the copy must carry every blocking-card declaration, or declare it a justified deviation')
})

test('no deviation outlives its justification', { skip: !existsSync(ORIGINAL) && 'harness checkout not present' }, () => {
  const original = declarations(ORIGINAL)
  const stale = [...JUSTIFIED_DEVIATIONS.keys()].filter(decl => !original.has(decl))
  assert.deepEqual(stale, [],
    'a justified deviation that the original no longer carries must be removed from the list')
})

test('the transcription keeps the declarations that define the card', () => {
  const copy = declarations(COPY)
  // The load-bearing values a reader checks first when asking "is this the same
  // card?" — geometry and surface, not colour (colour is always a token).
  for (const [decl, why] of [
    ['border-radius:20px', 'the card radius'],
    ['background:var(--dsw-specific-input-major)', 'the input surface'],
    ['box-shadow:var(--dsw-elevation-panel)', 'the panel elevation'],
    ['padding:0010px', 'zero-padding card with a section-owned footer inset'],
    ['padding:20px16px024px', 'the header insets'],
    ['gap:4px', 'the header action group spacing'],
    ['width:20px', 'the 20x20 indicator seat'],
    ['height:20px', 'the 20x20 indicator seat'],
    ['border-radius:6px', 'the indicator corner'],
    ['max-height:min(40vh,360px)', 'this surface\'s documented cap'],
    ['font-variant-numeric:tabular-nums', "the countdown's non-jittering digits"],
  ]) {
    assert.ok(copy.has(decl), `the copy must carry ${why} (${decl})`)
  }
})

test('the transcription introduces no literal colour and no theme selector', () => {
  const source = readFileSync(COPY, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  // `#0000` is lightningcss's minified `transparent`; it is not a palette value.
  assert.doesNotMatch(source.replaceAll('#0000', ''), /#[0-9a-fA-F]{3,8}\b/,
    'every colour must come from a --dsw-* token')
  assert.doesNotMatch(source, /prefers-color-scheme|\[data-theme/,
    'the card must not select on theme; the tokens already carry the pair')
})
