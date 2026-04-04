const assert = require('node:assert/strict')
const test = require('node:test')

const { parseTranscriptJSONL } = require('../dist/transcript')

const line = (entry) => JSON.stringify(entry)

test('parseTranscriptJSONL returns empty string for empty input', () => {
  assert.equal(parseTranscriptJSONL('', 2), '')
})

test('parseTranscriptJSONL handles a single human message', () => {
  const raw = line({
    type: 'human',
    message: { content: [{ type: 'text', text: 'Hello there' }] }
  })
  assert.equal(parseTranscriptJSONL(raw, 2), 'User: Hello there')
})

test('parseTranscriptJSONL skips assistant entries without reasoning', () => {
  const raw = [
    line({ type: 'human', message: { content: 'Ping' } }),
    line({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }
        ]
      }
    })
  ].join('\n')

  assert.equal(parseTranscriptJSONL(raw, 2), 'User: Ping')
})

test('parseTranscriptJSONL omits tool_result content', () => {
  const raw = [
    line({ type: 'human', message: { content: 'Run tests' } }),
    line({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Running tests.' },
          { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }
        ]
      }
    }),
    line({ type: 'tool_result', content: 'SECRET_OUTPUT' }),
    line({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Finished.' },
          { type: 'tool_use', name: 'Bash', input: { command: 'echo done' } }
        ]
      }
    })
  ].join('\n')

  const output = parseTranscriptJSONL(raw, 2)
  assert.ok(!output.includes('SECRET_OUTPUT'))
})

test('parseTranscriptJSONL keeps chronological order', () => {
  const raw = [
    line({ type: 'human', message: { content: 'Initial request' } }),
    line({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Need more info?' }] }
    }),
    line({ type: 'human', message: { content: 'Here is more info' } }),
    line({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Investigating.' },
          { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }
        ]
      }
    }),
    line({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Checking config.' },
          { type: 'tool_use', name: 'Bash', input: { command: 'cat config' } }
        ]
      }
    })
  ].join('\n')

  const expected = [
    'Assistant: Need more info?',
    'User: Here is more info',
    '',
    'Reasoning: Investigating.',
    'Tool calls:',
    '  - Tool: Bash Input: {"command":"ls"}',
    '',
    'Reasoning: Checking config.'
  ].join('\n')

  assert.equal(parseTranscriptJSONL(raw, 2), expected)
})

test('parseTranscriptJSONL respects lastReasoningPairs', () => {
  const raw = [
    line({ type: 'human', message: { content: 'Please review' } }),
    line({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'First reasoning.' },
          { type: 'tool_use', name: 'Bash', input: { command: 'first' } }
        ]
      }
    }),
    line({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Second reasoning.' },
          { type: 'tool_use', name: 'Bash', input: { command: 'second' } }
        ]
      }
    }),
    line({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Third reasoning.' },
          { type: 'tool_use', name: 'Bash', input: { command: 'third' } }
        ]
      }
    })
  ].join('\n')

  const expectedOne = [
    'User: Please review',
    '',
    'Reasoning: Third reasoning.'
  ].join('\n')
  const expectedTwo = [
    'User: Please review',
    '',
    'Reasoning: Second reasoning.',
    'Tool calls:',
    '  - Tool: Bash Input: {"command":"second"}',
    '',
    'Reasoning: Third reasoning.'
  ].join('\n')
  const expectedThree = [
    'User: Please review',
    '',
    'Reasoning: First reasoning.',
    'Tool calls:',
    '  - Tool: Bash Input: {"command":"first"}',
    '',
    'Reasoning: Second reasoning.',
    'Tool calls:',
    '  - Tool: Bash Input: {"command":"second"}',
    '',
    'Reasoning: Third reasoning.'
  ].join('\n')

  assert.equal(parseTranscriptJSONL(raw, 1), expectedOne)
  assert.equal(parseTranscriptJSONL(raw, 2), expectedTwo)
  assert.equal(parseTranscriptJSONL(raw, 3), expectedThree)
})
