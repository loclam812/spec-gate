import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

const parts = (version) => String(version).split('.').slice(0, 3).map(Number)

function newer(a, b) {
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < 3; i += 1) {
    if (x[i] !== y[i]) return x[i] > y[i]
  }
  return false
}

function highestInstalled(env) {
  const dir = env.CLAUDE_CONFIG_DIR || join(env.HOME ?? homedir(), '.claude')
  const entries = readJson(join(dir, 'plugins', 'installed_plugins.json'))?.plugins?.['spec-gate@spec-gate']
  if (!Array.isArray(entries)) return null
  const versions = entries.map((entry) => entry?.version).filter((version) => typeof version === 'string')
  return versions.reduce((best, version) => (best === null || newer(version, best) ? version : best), null)
}

export function staleVersionWarning(env = process.env) {
  const installed = highestInstalled(env)
  if (installed === null || !newer(installed, VERSION)) return null
  return `spec-gate ${VERSION} is running but ${installed} is installed; start a new Claude Code session to load it`
}
