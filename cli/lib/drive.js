import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, matchesGlob, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stringify } from 'yaml'
import { runTests } from '../tests.js'
import { LOCALE_DIR } from './qc-packet.js'
import { readPaths, renderPrompt, resultTotals, watchedPaths, withHidden } from './candidate.js'
import { readJson, writeJson } from './files.js'
import { answersText, specFiles } from './sample.js'
import { resetTree } from './workspace.js'

const ANSWERER = fileURLToPath(new URL('../../prompts/answerer.md', import.meta.url))
const MAX_STEPS = 40
// A driven run spawns several agents; it gets this many agent timeouts in total.
const RUN_TIMEOUT_FACTOR = 2
const ARTIFACTS = ['cases.yaml', 'decisions.md', 'ready.md', 'report.md', 'state.json']
const SOURCE_EXTENSION = /\.(js|jsx|ts|tsx|go|py|java|kt|rb|cs|vue|svelte)$/

// The spec files become the request. Their source lines (see "Writing a sample") are provenance,
// not requirement, so they are left out of the sentences the BA must map.
function requestText(sample) {
  return specFiles(sample)
    .map((name) => readFileSync(join(sample.dir, 'spec', name), 'utf8').replace(/^Source:.*\n+/, '').trim())
    .join('\n\n')
}

function spawnAgent({ prompt, model, tools, timeoutS, cwd, home }, env, hide) {
  const result = withHidden(hide, () =>
    spawnSync(
      'claude',
      [
        '-p', prompt,
        '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
        '--setting-sources', 'project', '--strict-mcp-config', '--permission-mode', 'acceptEdits',
        '--add-dir', home, '--model', model, '--allowedTools', tools.join(','),
      ],
      { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: timeoutS * 1000, maxBuffer: 64 * 1024 * 1024 },
    ),
  )
  const transcript = result.stdout ?? ''
  const agent = { model, transcript, usd: resultTotals(transcript).usd }
  if (result.error?.code === 'ETIMEDOUT') return { ...agent, failure: `claude timed out after ${timeoutS} s` }
  if (result.status !== 0) {
    return { ...agent, failure: `claude exited ${result.status ?? result.error?.code}: ${(result.stderr ?? '').trim().slice(-500)}` }
  }
  return agent
}

// The answerer sees only the questions and the answers file: its prompt is inline, it runs
// outside the tree, and it can write its answers but read nothing, so the buggy code cannot
// stand in for the product owner.
function answer(instruction, sample, home, env, hide, timeoutS) {
  rmSync(instruction.answers_file, { force: true })
  const prompt = renderPrompt(readFileSync(ANSWERER, 'utf8'), {
    questions: stringify(instruction.questions),
    answers: answersText(sample),
    output: instruction.answers_file,
  })
  return { step: 'answer', ...spawnAgent({ prompt, model: 'sonnet', tools: ['Write'], timeoutS, cwd: home, home }, env, hide) }
}

function cliFor(preDir, env) {
  return (...argv) => {
    const chunks = []
    runTests([...argv, '--repo', preDir], { env, out: { write: (text) => chunks.push(text) } })
    return JSON.parse(chunks.join(''))
  }
}

function timeLeft(timeoutS) {
  const deadline = Date.now() + timeoutS * RUN_TIMEOUT_FACTOR * 1000
  return () => {
    const left = Math.floor((deadline - Date.now()) / 1000)
    if (left <= 0) throw new Error(`driver: out of time after ${timeoutS * RUN_TIMEOUT_FACTOR} s`)
    return Math.min(timeoutS, left)
  }
}

function placeKnowledge(sample, preDir) {
  const knowledge = join(sample.dir, 'knowledge.md')
  if (!existsSync(knowledge)) return null
  const target = join(preDir, '.claude', 'testing.md')
  const previous = existsSync(target) ? readFileSync(target, 'utf8') : null
  mkdirSync(join(preDir, '.claude'), { recursive: true })
  cpSync(knowledge, target)
  return { previous }
}

function restoreKnowledge(placed, preDir) {
  if (!placed) return
  const target = join(preDir, '.claude', 'testing.md')
  if (placed.previous === null) rmSync(target, { force: true })
  else writeFileSync(target, placed.previous)
}

function runDirOf(home, run) {
  const projects = join(home, 'projects')
  const slug = readdirSync(projects).find((name) => existsSync(join(projects, name, 'runs', run)))
  return join(projects, slug, 'runs', run)
}

function qcReads(agents, preDir, runDir) {
  const profilePath = runDir ? join(runDir, 'profile.json') : null
  const globs = profilePath && existsSync(profilePath) ? readJson(profilePath).stacks.flatMap((stack) => stack.test_globs) : []
  const isTest = (path) => globs.some((glob) => matchesGlob(path, glob))
  const transcript = agents.filter((agent) => agent.step === 'qc').map((agent) => agent.transcript).join('\n')
  const reads = readPaths(transcript, preDir)
    .map((path) => [relative(preDir, path), relative(realpathSync(preDir), path)].find((rel) => !rel.startsWith('..')))
    .filter((path) => path && SOURCE_EXTENSION.test(path) && !LOCALE_DIR.test(path) && !isTest(path))
  return [...new Set(reads)].sort()
}

function saveArtifacts({ home, run, outDir, agents, watch, preDir, stuck }) {
  mkdirSync(join(outDir, 'spec-to-tests'), { recursive: true })
  const runDir = run ? runDirOf(home, run) : null
  for (const name of ARTIFACTS.filter((file) => runDir && existsSync(join(runDir, file)))) {
    cpSync(join(runDir, name), join(outDir, 'spec-to-tests', name))
  }
  const transcript = agents.map((agent) => agent.transcript).join('\n')
  writeFileSync(join(outDir, 'transcript.jsonl'), transcript)
  writeJson(join(outDir, 'leaks.json'), { outside: watchedPaths(transcript, preDir, watch) })
  writeJson(join(outDir, 'cost.json'), {
    usd: agents.reduce((sum, agent) => sum + agent.usd, 0),
    agents: agents.map(({ step, model, usd }) => ({ step, model, usd })),
  })
  if (stuck) writeJson(join(outDir, 'stuck.json'), { reason: stuck })
  try {
    writeJson(join(outDir, 'qc-reads.json'), { reads: qcReads(agents, preDir, runDir) })
  } catch (error) {
    writeJson(join(outDir, 'qc-reads.json'), { reads: null, error: error.message })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

// Runs the tests flow headless inside the pre-fix tree until the tests are written. Its
// run store lives in a temporary home outside the watched paths, so agents reading their own
// prompt files are not leaks. A claude that fails ends the run with an error, as a prompted
// candidate's does, so batch retries it instead of scoring it empty.
export function driveSpecToTests(candidate, sample, preDir, outDir, { env = process.env, hide = [], watch = [] } = {}) {
  resetTree(preDir)
  rmSync(outDir, { recursive: true, force: true })
  const home = mkdtempSync(join(tmpdir(), 'sg-drive-'))
  const runEnv = { ...env, SPEC_GATE_HOME: home, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }
  const requestFile = join(home, 'request.md')
  writeFileSync(requestFile, requestText(sample))
  const placed = placeKnowledge(sample, preDir)
  const cli = cliFor(preDir, runEnv)
  const remainingS = timeLeft(candidate.timeout_s)
  const agents = []
  const record = (agent) => {
    agents.push(agent)
    if (agent.failure) throw new Error(agent.failure)
  }
  let run = null
  let stuck = null
  try {
    run = cli('start', '--request-file', requestFile).run
    const act = (instruction) => {
      if (instruction.kind === 'cli') return cli('submit', '--run', run)
      if (instruction.kind === 'approve') return cli('submit', '--run', run, '--approve')
      if (instruction.kind === 'ask') {
        record(answer(instruction, sample, home, runEnv, hide, remainingS()))
        return cli('submit', '--run', run, '--answers', instruction.answers_file)
      }
      if (instruction.kind === 'agent') {
        const prompt = `Read ${instruction.prompt_file} and do exactly what it says.`
        const spec = { prompt, model: instruction.model, tools: candidate.allowed_tools, timeoutS: remainingS(), cwd: preDir, home }
        record({ step: instruction.step, ...spawnAgent(spec, runEnv, hide) })
        return cli('submit', '--run', run)
      }
      throw new Error(`driver: unexpected instruction ${instruction.kind}`)
    }
    const last = Array.from({ length: MAX_STEPS }).reduce((previous) => {
      if (['done', 'stuck'].includes(previous?.kind)) return previous
      const instruction = cli('next', '--run', run)
      if (!['done', 'stuck'].includes(instruction.kind)) act(instruction)
      return instruction
    }, null)
    stuck = last.kind === 'stuck' ? last.reason : last.kind === 'done' ? null : `driver: no end after ${MAX_STEPS} steps`
  } finally {
    try {
      saveArtifacts({ home, run, outDir, agents, watch, preDir, stuck })
    } finally {
      restoreKnowledge(placed, preDir)
    }
  }
}
