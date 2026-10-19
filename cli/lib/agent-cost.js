import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

const KEYS = ['in', 'out', 'cache_write_5m', 'cache_write_1h', 'cache_read']

// USD per million tokens, in KEYS order. shortcut: Anthropic list prices cached 2026-10-06 (Haiku at
// its up-to-100K-prompt rate); update when prices change or a new model ships.
const PRICES = {
  'claude-fable-5-1': [10, 50, 12.5, 20, 0.25],
  'claude-opus-5-5': [4, 20, 5, 8, 0.2],
  'claude-sonnet-5-5': [2, 10, 2.5, 4, 0.2],
  'claude-haiku-5-5': [0.1, 0.5, 0.125, 0.2, 0.01],
}

const configDir = (env) => env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
const childDirs = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(dir, entry.name)) : [])

function usageOf(usage = {}) {
  const written = usage.cache_creation ?? {}
  return {
    in: usage.input_tokens ?? 0,
    out: usage.output_tokens ?? 0,
    cache_write_5m: written.ephemeral_5m_input_tokens ?? usage.cache_creation_input_tokens ?? 0,
    cache_write_1h: written.ephemeral_1h_input_tokens ?? 0,
    cache_read: usage.cache_read_input_tokens ?? 0,
  }
}

const parseLine = (line) => {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

// Claude Code keeps each subagent's transcript at projects/<cwd>/<session>/subagents/agent-*.jsonl.
// The format is undocumented, so a transcript that cannot be read is simply not counted.
export function findTranscripts(env, promptFile, { since }) {
  return childDirs(join(configDir(env), 'projects'))
    .flatMap(childDirs)
    .map((session) => join(session, 'subagents'))
    .filter((dir) => existsSync(dir))
    .flatMap((dir) => readdirSync(dir).filter((name) => name.endsWith('.jsonl')).map((name) => join(dir, name)))
    .filter((file) => statSync(file).mtimeMs >= since && readFileSync(file, 'utf8').includes(promptFile))
}

// Streamed entries repeat one message's usage, so each message counts once, at its largest.
export function agentCost(file) {
  const entries = readFileSync(file, 'utf8').split('\n').map(parseLine).filter((entry) => entry?.type === 'assistant' && entry.message)
  const perMessage = entries.reduce((seen, { message, uuid }) => {
    const id = message.id ?? uuid
    const current = usageOf(message.usage)
    const previous = seen.get(id)
    return new Map(seen).set(id, previous ? Object.fromEntries(KEYS.map((key) => [key, Math.max(previous[key], current[key])])) : current)
  }, new Map())
  const tokens = Object.fromEntries(KEYS.map((key) => [key, [...perMessage.values()].reduce((sum, usage) => sum + usage[key], 0)]))
  const model = entries.map(({ message }) => message.model).filter((name) => name && name !== '<synthetic>').at(-1) ?? null
  const price = PRICES[model?.replace(/\[.*\]$/, '')]
  const usd = price ? Math.round(KEYS.reduce((sum, key, index) => sum + tokens[key] * price[index], 0)) / 1_000_000 : null
  return { transcript: basename(file), model, tokens, usd }
}

// A retried writer may be the same agent resumed, so a transcript logged before counts only what it
// added since.
export function costSince(cost, logged) {
  const tokens = Object.fromEntries(KEYS.map((key) => [key, cost.tokens[key] - logged.reduce((sum, event) => sum + (event.tokens?.[key] ?? 0), 0)]))
  const usd = cost.usd === null ? null : Math.round((cost.usd - logged.reduce((sum, event) => sum + (event.usd ?? 0), 0)) * 1_000_000) / 1_000_000
  return { ...cost, tokens, usd }
}

export const addsTokens = (cost) => KEYS.some((key) => cost.tokens[key] > 0)
