import { readFileSync } from 'node:fs'
import { join, matchesGlob } from 'node:path'
import { tryGit } from './exec.js'
import { section } from './knowledge.js'
import { screenNames } from './profile.js'

const LOCALE_DIR = /(^|\/)(locales?|i18n|lang|translations)\//
const LOCALE_FILE = /\.(json|ya?ml|po|properties)$/
const MAX_TEXT_LINES = 300
const MAX_LIST = 200

const tracked = (repo) => (tryGit(repo, ['ls-files']) ?? '').split('\n').filter(Boolean)
const bullets = (items) => (items.length > 0 ? items.slice(0, MAX_LIST).map((item) => `- ${item}`).join('\n') : 'None found.')

// User-facing strings say what the product promises without showing how the code does it.
function userFacingText(repo, files) {
  const lines = files
    .filter((file) => LOCALE_DIR.test(file) && LOCALE_FILE.test(file))
    .flatMap((file) => [`# ${file}`, ...readFileSync(join(repo, file), 'utf8').split('\n')])
  return lines.length > 0 ? lines.slice(0, MAX_TEXT_LINES).join('\n') : 'None found.'
}

export function buildQcPacket({ repo, request, knowledgeText, profile }) {
  const files = tracked(repo)
  const globs = profile.stacks.flatMap((stack) => stack.test_globs)
  const tests = files.filter((file) => globs.some((glob) => matchesGlob(file, glob)))
  return [
    `## Request\n\n${request.trim()}`,
    `## Domain terms\n\n${section(knowledgeText ?? '', 'Domain terms') || 'None given.'}`,
    `## User-facing text\n\n${userFacingText(repo, files)}`,
    `## Screens and routes\n\n${bullets(screenNames(repo))}`,
    `## Existing tests\n\n${bullets(tests)}`,
  ].join('\n\n')
}
