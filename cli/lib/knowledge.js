import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectDir } from './store.js'

export const KNOWLEDGE_SECTIONS = ['Run', 'Where tests go', 'Helpers and fixtures', 'Mocking rules', 'Known traps', 'Domain terms']
const MAX_LINES = 200

export function knowledgePaths(repo, slug, env) {
  return { repo: join(repo, '.claude', 'testing.md'), store: join(projectDir(slug, env), 'knowledge.md') }
}

export function findKnowledge(repo, slug, env) {
  const paths = knowledgePaths(repo, slug, env)
  const path = [paths.repo, paths.store].find((candidate) => existsSync(candidate))
  return path ? { path, text: readFileSync(path, 'utf8') } : null
}

const headings = (text) => text.split('\n').filter((line) => line.startsWith('## ')).map((line) => line.slice(3).trim())

export function knowledgeErrors(text) {
  const present = headings(text)
  const missing = KNOWLEDGE_SECTIONS.filter((name) => !present.includes(name)).map((name) => `knowledge: missing section "## ${name}"`)
  const lines = text.replace(/\n$/, '').split('\n').length
  return [...missing, ...(lines > MAX_LINES ? [`knowledge: keep it under ${MAX_LINES} lines (it has ${lines})`] : [])]
}

export function section(text, name) {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line.trim() === `## ${name}`)
  if (start === -1) return ''
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim()
}

// A repository can name its own skill for turning a bug report into a failing test; fix-bug uses it.
export function bugSkill(text) {
  return /^Bug-reproduction skill:\s*(\S+)/m.exec(text ?? '')?.[1] ?? null
}
