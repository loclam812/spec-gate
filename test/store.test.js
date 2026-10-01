import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { basename, dirname } from 'node:path'
import { git } from '../cli/lib/exec.js'
import { repoSlug, sampleDir, slugFromPath, slugFromRemote, storeRoot, workDir } from '../cli/lib/store.js'
import { makeFixtureRepo } from './helpers.js'

describe('slugFromRemote', () => {
  const cases = [
    ['https://github.com/Acme/Shop.git', 'github.com-acme-shop'],
    ['https://github.com/acme/shop/', 'github.com-acme-shop'],
    ['git@github.com:acme/shop.git', 'github.com-acme-shop'],
    ['ssh://git@gitlab.example.org:2222/team/sub/shop.git', 'gitlab.example.org-team-sub-shop'],
    ['https://user@bitbucket.org/acme/shop', 'bitbucket.org-acme-shop'],
  ]
  for (const [url, slug] of cases) {
    it(`${url} -> ${slug}`, () => assert.equal(slugFromRemote(url), slug))
  }
})

it('slugFromPath turns a git common dir into a local slug', () => {
  assert.equal(slugFromPath('/Users/me/work/Shop/.git'), 'local-users-me-work-shop')
})

it('repoSlug prefers the origin remote', () => {
  const { repo } = makeFixtureRepo()
  git(repo, ['remote', 'add', 'origin', 'git@github.com:acme/shop.git'])
  assert.equal(repoSlug(repo), 'github.com-acme-shop')
})

it('repoSlug falls back to the git common dir without a remote', () => {
  const { repo } = makeFixtureRepo()
  assert.match(repoSlug(repo), /^local-/)
})

it('storeRoot honours SPEC_GATE_HOME', () => {
  assert.equal(storeRoot({ SPEC_GATE_HOME: '/tmp/sg-home' }), '/tmp/sg-home')
  assert.equal(sampleDir('s', 'x', { SPEC_GATE_HOME: '/tmp/sg-home' }), '/tmp/sg-home/projects/s/eval/x')
})

it('workDir names neither the repository nor the sample', () => {
  const dir = workDir('github.com-acme-shop', 'shop-42')
  assert.equal(dirname(dir), tmpdir())
  assert.match(basename(dir), /^sg-[0-9a-f]{10}$/)
  assert.equal(dir, workDir('github.com-acme-shop', 'shop-42'))
})
