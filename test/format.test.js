const assert = require('node:assert/strict')
const test = require('node:test')

const { MAX_TOOL_INPUT_CHARS } = require('../dist/constants')
const {
  formatNoteForChunk,
  formatScatterUserPrompt,
  parseBulletList
} = require('../dist/format')

test('formatNoteForChunk uses the unicode arrow', () => {
  const note = {
    content: 'Remember the auth expiry',
    when: 'auth module',
    timestamp: new Date('2024-03-26T00:00:00Z').getTime(),
    id: 'note-1',
    tokens: 5
  }
  const formatted = formatNoteForChunk(note)
  assert.ok(formatted.includes('\u2192 activate when: auth module'))
})

test('formatScatterUserPrompt truncates tool input', () => {
  const longInput = 'a'.repeat(MAX_TOOL_INPUT_CHARS + 10)
  const prompt = formatScatterUserPrompt('transcript', 'Bash', longInput)
  const inputLine = prompt.split('\n').find((line) => line.startsWith('Input: '))
  assert.ok(inputLine)
  assert.equal(inputLine.replace('Input: ', '').length, MAX_TOOL_INPUT_CHARS)
})

test('parseBulletList handles NONE and bullet lines', () => {
  assert.deepEqual(parseBulletList('NONE'), [])
  assert.deepEqual(parseBulletList(''), [])
  assert.deepEqual(parseBulletList('- one\n- two'), ['one', 'two'])
  assert.deepEqual(parseBulletList('random\n- three'), ['three'])
})
