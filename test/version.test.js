import { it } from 'node:test'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VERSION, staleVersionWarning } from '../cli/lib/version.js'

function configWith(content) {
  const home = mkdtempSync(join(tmpdir(), 'spec-gate-version-'))
  const dir = join(home, '.claude', 'plugins')
  mkdirSync(dir, { recursive: true })
  if (content !== undefined) writeFileSync(join(dir, 'installed_plugins.json'), content)
  return { HOME: home }
}

const installed = (...versions) =>
  JSON.stringify({ plugins: { 'spec-gate@spec-gate': versions.map((version) => ({ version })) } })

it('VERSION is the version in package.json', () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
  assert.equal(VERSION, pkg.version)
})

it('warns when a newer spec-gate is installed than the one running', () => {
  const env = configWith(installed('0.0.1', '99.0.0'))
  assert.equal(
    staleVersionWarning(env),
    `spec-gate ${VERSION} is running but 99.0.0 is installed; start a new Claude Code session to load it`,
  )
})

it('compares numeric parts, so 99.10.0 is newer than 99.9.0', () => {
  assert.match(staleVersionWarning(configWith(installed('99.9.0', '99.10.0'))), /99\.10\.0 is installed/)
})

it('returns null when the installed version is the same or older', () => {
  assert.equal(staleVersionWarning(configWith(installed(VERSION))), null)
  assert.equal(staleVersionWarning(configWith(installed('0.0.1'))), null)
})

it('uses CLAUDE_CONFIG_DIR when it is set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-gate-config-'))
  mkdirSync(join(dir, 'plugins'))
  writeFileSync(join(dir, 'plugins', 'installed_plugins.json'), installed('9.0.0'))
  assert.match(staleVersionWarning({ CLAUDE_CONFIG_DIR: dir, HOME: '/nonexistent' }), /9\.0\.0 is installed/)
})

it('returns null when the file is missing, unparsable or has an odd shape', () => {
  assert.equal(staleVersionWarning(configWith(undefined)), null)
  assert.equal(staleVersionWarning(configWith('{not json')), null)
  assert.equal(staleVersionWarning(configWith(JSON.stringify({ plugins: { 'spec-gate@spec-gate': 'x' } }))), null)
  assert.equal(staleVersionWarning(configWith('null')), null)
})

it('the CLI warns on stderr about a newer install and still exits 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-gate-config-'))
  mkdirSync(join(dir, 'plugins'))
  writeFileSync(join(dir, 'plugins', 'installed_plugins.json'), installed('99.0.0'))
  const store = mkdtempSync(join(tmpdir(), 'spec-gate-home-'))
  const bin = fileURLToPath(new URL('../cli/spec-gate.js', import.meta.url))
  const result = spawnSync(process.execPath, [bin, 'log', '--since', '1d'], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: dir, SPEC_GATE_HOME: store },
  })
  assert.equal(result.status, 0)
  assert.match(result.stderr, /99\.0\.0 is installed/)
})
