const assert = require('node:assert/strict')
const test = require('node:test')

const { MEMORY_REMINDER_TEXT } = require('../dist/constants')
const { runRemind } = require('../dist/remind')

test('runRemind returns JSON output for normal tool usage', async () => {
  const input = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'ls -a' }
  })
  const output = await runRemind(input)
  const parsed = JSON.parse(output)
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PostToolUse')
  assert.equal(parsed.hookSpecificOutput.additionalContext, MEMORY_REMINDER_TEXT)
})

test('runRemind skips claude-memory commands', async () => {
  const input = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'claude-memory list' }
  })
  const output = await runRemind(input)
  assert.equal(output, '')
})
