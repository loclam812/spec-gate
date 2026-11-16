import { it } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { stringify } from 'yaml'
import { CASES, REQUEST, setup } from './tests-helpers.js'

const DECIDED = { ...CASES, cases: CASES.cases.map((c) => ({ ...c, basis: 'decision' })) }

it('the QC cannot label a case decision before any answer is on record', () => {
  const { cli } = setup()
  cli('start', '--request', REQUEST)
  cli('submit')
  writeFileSync(cli('next').json.output, stringify(DECIDED))
  assert.match(cli('submit').json.errors.join('\n'), /basis is decision, but no answer or project decision is on record/)
})

it('an unknown answer or a UX-source answer is not a decision', async () => {
  const { decisionsOnRecord } = await import('../cli/lib/cases.js')
  assert.equal(decisionsOnRecord('- Q1 Refund twice? (about: rule)\n  Answer: unknown\n', ''), false)
  assert.equal(decisionsOnRecord('- QUX1 Where is the design? (about: ux-source)\n  Answer: figma link\n', ''), false)
  assert.equal(decisionsOnRecord('- Q1 Refund twice? (about: rule)\n  Answer: refuse the second\n', ''), true)
  assert.equal(decisionsOnRecord('', '- Do refunds over 1000 need a manager? (about: rule, 2026-11-16)\n  Answer: yes\n'), true)
  assert.equal(decisionsOnRecord('', '- Where is the design? (about: ux-source, 2026-11-16)\n  Answer: figma\n'), false)
  assert.equal(decisionsOnRecord('- Dropped C2 at write-tests: needs a browser\n- Rejected at Ready: too few cases\n', ''), false)
})
