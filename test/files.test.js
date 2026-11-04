import { it } from 'node:test'
import assert from 'node:assert/strict'
import { posixPath } from '../cli/lib/files.js'

it('posixPath turns separators into slashes', () => {
  assert.equal(posixPath('test\\a.test.js'), 'test/a.test.js')
  assert.equal(posixPath('test/a.test.js'), 'test/a.test.js')
})
