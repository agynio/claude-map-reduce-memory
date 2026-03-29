const assert = require('node:assert/strict')
const test = require('node:test')

const { extractExistingHints } = require('../dist/dedup')

test('extractExistingHints pulls [MEMORY] hints from transcript', () => {
  const transcript = [
    '<system-reminder>',
    '[MEMORY] Auth expiry should be 900s',
    '</system-reminder>',
    '<system-reminder>',
    '[MEMORY] Redis chosen for session storage',
    '</system-reminder>'
  ].join('\n')

  assert.deepEqual(extractExistingHints(transcript), [
    'Auth expiry should be 900s',
    'Redis chosen for session storage'
  ])
})

test('extractExistingHints returns empty array when none', () => {
  assert.deepEqual(extractExistingHints('No reminders here.'), [])
})
