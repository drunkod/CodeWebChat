import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CwcMcpError, toErrorText } from './errors.js'

// Fast unit tests — no server, no WebSocket, no clipboard.

test('toErrorText returns the message of an Error', () => {
  assert.equal(toErrorText(new Error('boom')), 'boom')
})

test('toErrorText stringifies non-Error values', () => {
  assert.equal(toErrorText('plain string'), 'plain string')
  assert.equal(toErrorText(42), '42')
})

test('CwcMcpError carries a machine-readable code and name', () => {
  const err = new CwcMcpError('no websocket', 'CWC_NOT_CONNECTED')
  assert.equal(err.code, 'CWC_NOT_CONNECTED')
  assert.equal(err.name, 'CwcMcpError')
  assert.equal(err.message, 'no websocket')
  assert.ok(err instanceof Error)
})
