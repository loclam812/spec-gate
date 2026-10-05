import { it } from 'node:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { buildQcPacket } from '../cli/lib/qc-packet.js'
import { commitAll, makeFixtureRepo, writeFile } from './helpers.js'

it('the QC packet carries the request, domain terms, user-facing text, screens and test names, and no code', () => {
  const { repo } = makeFixtureRepo()
  writeFile(repo, 'src/locales/en.json', '{ "refund.title": "Request a refund" }\n')
  writeFile(repo, 'src/screens/Checkout.tsx', 'export const SECRET_IMPLEMENTATION = 1\n')
  writeFile(repo, 'test/total.test.js', "test('adds lines', () => {})\n")
  commitAll(repo, 'locale, screen, test')
  const packet = buildQcPacket({
    repo,
    request: 'Refunds need approval.',
    knowledgeText: '## Domain terms\n- refund: Refund\n## Run\nnpm test\n',
    profile: { stacks: [{ name: 'node-test', test_globs: ['**/*.test.js'] }] },
  })
  assert.match(packet, /## Request\n\nRefunds need approval\./)
  assert.match(packet, /## Domain terms\n\n- refund: Refund/)
  assert.match(packet, /"refund\.title": "Request a refund"/)
  assert.match(packet, /## Screens and routes\n\n- Checkout/)
  assert.match(packet, /## Existing tests\n\n- test\/total\.test\.js/)
  assert.doesNotMatch(packet, /SECRET_IMPLEMENTATION|npm test/)
})

it('a tracked locale file deleted in the working tree is skipped, and the text stops at 300 lines', () => {
  const { repo } = makeFixtureRepo()
  writeFile(repo, 'src/locales/old.json', '{ "gone": "removed" }\n')
  writeFile(repo, 'src/locales/en.json', `${Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n')}\n`)
  commitAll(repo, 'locales')
  rmSync(join(repo, 'src/locales/old.json'))
  const packet = buildQcPacket({ repo, request: 'Refunds.', knowledgeText: '', profile: { stacks: [] } })
  assert.doesNotMatch(packet, /removed/)
  assert.match(packet, /line 298/)
  assert.doesNotMatch(packet, /line 299/)
})
