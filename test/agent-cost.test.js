import { it } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { stringify } from 'yaml'
import { runLog } from '../cli/log.js'
import { agentCost, findTranscripts } from '../cli/lib/agent-cost.js'
import { tempDir, writeFile } from './helpers.js'
import { C1_TEST, CASES, REQUEST, setup } from './tests-helpers.js'

const assistant = (id, model, usage) => JSON.stringify({ type: 'assistant', message: { id, model, usage } })
const prompt = (file) => JSON.stringify({ type: 'user', message: { role: 'user', content: `Read ${file} and do exactly what it says.` } })

function writeTranscript(configDir, name, lines) {
  writeFile(configDir, join('projects', '-repo', 'session-1', 'subagents', name), `${lines.join('\n')}\n`)
  return join(configDir, 'projects', '-repo', 'session-1', 'subagents', name)
}

it('a transcript is priced once per message, counting cache writes and reads at their own rates', () => {
  const config = tempDir('sg-config-')
  const file = writeTranscript(config, 'agent-a.jsonl', [
    prompt('/runs/r1/prompts/write-tests.md'),
    assistant('m1', 'claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 10, cache_creation: { ephemeral_5m_input_tokens: 0 } }),
    assistant('m1', 'claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 100_000, cache_creation: { ephemeral_5m_input_tokens: 0 } }),
    assistant('m2', 'claude-sonnet-5-5', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 } }),
  ])
  const cost = agentCost(file)
  assert.equal(cost.model, 'claude-sonnet-5-5')
  assert.deepEqual(cost.tokens, { in: 1_000_000, out: 100_000, cache_write_5m: 1_000_000, cache_write_1h: 1_000_000, cache_read: 1_000_000 })
  assert.equal(cost.usd, 2 + 1 + 2.5 + 4 + 0.2)
})

it('a model without a known price keeps its tokens and has no usd', () => {
  const config = tempDir('sg-config-')
  const file = writeTranscript(config, 'agent-b.jsonl', [assistant('m1', 'claude-sonnet-4-6', { input_tokens: 5, output_tokens: 5 })])
  const cost = agentCost(file)
  assert.equal(cost.usd, null)
  assert.equal(cost.tokens.in, 5)
})

it('only recent transcripts that read the prompt file are found', () => {
  const config = tempDir('sg-config-')
  const promptFile = '/runs/r1/prompts/write-tests.md'
  writeTranscript(config, 'agent-a.jsonl', [prompt(promptFile), assistant('m1', 'claude-sonnet-5-5', { output_tokens: 1 })])
  writeTranscript(config, 'agent-b.jsonl', [prompt('/runs/other/prompts/write-tests.md'), assistant('m1', 'claude-sonnet-5-5', { output_tokens: 1 })])
  writeTranscript(config, 'agent-c.jsonl', [prompt(promptFile), assistant('m1', 'claude-sonnet-5-5', { output_tokens: 1 })])
  const found = (options) => findTranscripts({ CLAUDE_CONFIG_DIR: config }, promptFile, options).map((file) => file.split('/').pop())
  assert.deepEqual(found({ since: 0 }).sort(), ['agent-a.jsonl', 'agent-c.jsonl'])
  assert.deepEqual(found({ since: Date.now() + 60_000 }), [])
  assert.deepEqual(findTranscripts({ CLAUDE_CONFIG_DIR: tempDir('sg-empty-') }, promptFile, { since: 0 }), [])
})

it('each write-tests submit logs what its writer added, a resumed writer included, and the log sums the run cost', () => {
  const { repo, env, cli } = setup()
  cli('start', '--request', REQUEST)
  cli('submit')
  writeFileSync(cli('next').json.output, stringify(CASES))
  cli('submit')
  cli('submit', '--approve')
  const writer = cli('next').json
  const usage = { input_tokens: 1_000_000, output_tokens: 0 }
  const first = writeTranscript(env.CLAUDE_CONFIG_DIR, 'agent-w1.jsonl', [prompt(writer.prompt_file), assistant('m1', 'claude-sonnet-5-5', usage)])
  writeFileSync(writer.output, stringify({ files: ['test/missing.test.js'] }))
  assert.equal(cli('submit').json.step, 'write-tests')
  appendFileSync(first, `${assistant('m2', 'claude-sonnet-5-5', usage)}\n`)
  writeTranscript(env.CLAUDE_CONFIG_DIR, 'agent-w2.jsonl', [prompt(cli('next').json.prompt_file), assistant('m1', 'claude-sonnet-5-5', usage)])
  writeFile(repo, 'test/total.test.js', C1_TEST)
  writeFileSync(writer.output, stringify({ files: ['test/total.test.js'] }))
  assert.equal(cli('submit').json.step, 'done')
  const dir = dirname(writer.prompt_file.replace('/prompts/', '/'))
  const costs = readFileSync(join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)).filter((event) => event.kind === 'write-tests')
  assert.deepEqual(costs.map((event) => [event.transcript, event.model, event.usd]), [['agent-w1.jsonl', 'claude-sonnet-5-5', 2], ['agent-w1.jsonl', 'claude-sonnet-5-5', 2], ['agent-w2.jsonl', 'claude-sonnet-5-5', 2]])
  const chunks = []
  runLog(['--since', '1d'], { env, out: { write: (text) => chunks.push(text) } })
  const { runs, summary } = JSON.parse(chunks.join(''))
  assert.equal(runs[0].usd, 6)
  assert.equal(summary.usd, 6)
})
