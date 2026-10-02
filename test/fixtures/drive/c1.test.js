import { test } from 'node:test'
import assert from 'node:assert/strict'
import { total } from '../src/total.js'

test('C1: total multiplies price by quantity', () => {
  assert.equal(total([{ price: 2, qty: 3 }]), 6)
})
