import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

// Repo-relative paths are compared with git's and put into test commands, which both use /.
export const posixPath = (path) => path.replaceAll('\\', '/')
