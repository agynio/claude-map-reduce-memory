const assert = require('node:assert/strict')
const test = require('node:test')

const { resolveRetrieveMode, runRetrieveHook } = require('../dist/retrieve')

test('resolveRetrieveMode distinguishes query vs hook', () => {
  assert.deepEqual(resolveRetrieveMode(['query'], true), {
    mode: 'query',
    query: 'query',
    maxResults: 5
  })
  assert.deepEqual(resolveRetrieveMode([], false), { mode: 'hook' })
  assert.deepEqual(resolveRetrieveMode([], true), {
    mode: 'error',
    message: 'retrieve requires a query or piped stdin JSON'
  })
})

test('runRetrieveHook skips claude-memory commands', async () => {
  const input = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'claude-memory list' }
  })
  const output = await runRetrieveHook(input)
  assert.equal(output, '{}')
})
