const assert = require('node:assert/strict')
const test = require('node:test')

const { estimateTokens, truncateToTokenLimit } = require('../dist/tokens')

test('estimateTokens uses a 4-char divisor', () => {
  assert.equal(estimateTokens('abcd'), 1)
  assert.equal(estimateTokens('abcde'), 2)
  assert.equal(estimateTokens(''.padEnd(8, 'x')), 2)
})

test('truncateToTokenLimit keeps the most recent chars', () => {
  const text = 'abcdefghij'
  assert.equal(truncateToTokenLimit(text, 2), 'cdefghij')
  assert.equal(truncateToTokenLimit(text, 10), text)
})
