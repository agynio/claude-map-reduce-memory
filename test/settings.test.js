const assert = require('node:assert/strict')
const test = require('node:test')

const { removeHookEntry, upsertHookEntry } = require('../dist/settings')

test('upsertHookEntry replaces existing command entry', () => {
  const existing = {
    hooks: {
      PreToolUse: [
        { matcher: '', hooks: [{ type: 'command', command: 'cmr-memory retrieve' }] }
      ],
      Other: [{ matcher: '', hooks: [{ type: 'command', command: 'other' }] }]
    }
  }
  const replacement = {
    matcher: '',
    hooks: [{ type: 'command', command: 'cmr-memory retrieve', timeout: 15000 }]
  }

  const updated = upsertHookEntry(
    existing,
    'PreToolUse',
    replacement,
    'cmr-memory retrieve'
  )

  assert.equal(updated.hooks.PreToolUse.length, 1)
  assert.deepEqual(updated.hooks.PreToolUse[0], replacement)
  assert.equal(updated.hooks.Other.length, 1)
})

test('upsertHookEntry appends when command is missing', () => {
  const existing = {
    hooks: {
      PreToolUse: [
        { matcher: '', hooks: [{ type: 'command', command: 'other' }] }
      ]
    }
  }
  const entry = { matcher: '', hooks: [{ type: 'command', command: 'new' }] }
  const updated = upsertHookEntry(existing, 'PreToolUse', entry, 'new')

  assert.equal(updated.hooks.PreToolUse.length, 2)
})

test('removeHookEntry drops event when empty', () => {
  const existing = {
    hooks: {
      PostToolUse: [
        { matcher: '', hooks: [{ type: 'command', command: 'cmr-memory remind' }] }
      ],
      Other: [{ matcher: '', hooks: [{ type: 'command', command: 'other' }] }]
    }
  }

  const updated = removeHookEntry(
    existing,
    'PostToolUse',
    'cmr-memory remind'
  )

  assert.ok(!updated.hooks.PostToolUse)
  assert.equal(updated.hooks.Other.length, 1)
})
