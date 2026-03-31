const assert = require('node:assert/strict')
const test = require('node:test')

const {
  buildSection,
  detectLineEnding,
  findSectionRange,
  removeSectionContent,
  upsertSectionContent
} = require('../dist/claude-md')

const SECTION_START = '<!-- cmr-memory:start -->'
const SECTION_END = '<!-- cmr-memory:end -->'

test('detectLineEnding returns CRLF when present', () => {
  assert.equal(detectLineEnding('line\r\nline'), '\r\n')
})

test('detectLineEnding defaults to LF', () => {
  assert.equal(detectLineEnding('line\nline'), '\n')
  assert.equal(detectLineEnding('single line'), '\n')
})

test('buildSection includes memory guidance', () => {
  const section = buildSection('\n')
  assert.match(
    section,
    /When you need to retrieve or save memory, always use the `cmr-memory` CLI\./
  )
  assert.match(section, /## How It Works/)
  assert.match(section, /## Writing Memory/)
  assert.match(section, /## Searching Memory/)
  assert.match(section, /## Listing Recent Notes/)
})

test('findSectionRange returns null when markers missing', () => {
  assert.equal(findSectionRange('no markers here'), null)
  assert.equal(findSectionRange(`${SECTION_START}\nMissing end`), null)
})

test('findSectionRange returns expected slice', () => {
  const content = `Intro\n${SECTION_START}\nRule\n${SECTION_END}\nOutro`
  const range = findSectionRange(content)
  assert.ok(range)
  assert.equal(content.slice(range.start, range.end),
    `${SECTION_START}\nRule\n${SECTION_END}`)
})

test('upsertSectionContent appends to empty content', () => {
  const section = buildSection('\n')
  const output = upsertSectionContent('')
  assert.equal(output, `${section}\n`)
})

test('upsertSectionContent appends to existing content', () => {
  const section = buildSection('\n')
  const output = upsertSectionContent('Rules\n')
  assert.equal(output, `Rules\n${section}\n`)
})

test('upsertSectionContent is idempotent', () => {
  const first = upsertSectionContent('Rules\n')
  const second = upsertSectionContent(first)
  assert.equal(second, first)
})

test('upsertSectionContent respects CRLF endings', () => {
  const section = buildSection('\r\n')
  const output = upsertSectionContent('Rules\r\n')
  assert.equal(output, `Rules\r\n${section}\r\n`)
})

test('removeSectionContent strips section in the middle', () => {
  const section = buildSection('\n')
  const content = `Intro\n${section}\nOutro\n`
  const output = removeSectionContent(content)
  assert.equal(output, 'Intro\nOutro\n')
})

test('removeSectionContent removes section-only content', () => {
  const section = buildSection('\n')
  const output = removeSectionContent(`${section}\n`)
  assert.equal(output, '')
})

test('removeSectionContent is a no-op when missing', () => {
  assert.equal(removeSectionContent('Intro\nOutro\n'), 'Intro\nOutro\n')
})
