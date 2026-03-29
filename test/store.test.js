const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-memory-store-'))
process.env.HOME = tmpHome

const { DEFAULT_CONFIG } = require('../dist/constants')
const {
  appendNote,
  createNote,
  listChunkFiles,
  loadChunks,
  loadStateOrRebuild,
  resetStore
} = require('../dist/store')

test('store operations manage chunks and state', async () => {
  const note = createNote('  remember this ', '  when it matters  ')
  assert.equal(note.content, 'remember this')
  assert.equal(note.when, 'when it matters')
  assert.equal(typeof note.id, 'string')
  assert.equal(typeof note.timestamp, 'number')
  assert.ok(note.tokens > 0)

  const config = { ...DEFAULT_CONFIG, apiKey: 'test', chunkTokenLimit: 1 }
  await appendNote('First note', 'when testing', config)

  const chunks = await loadChunks()
  assert.equal(chunks.length, 2)
  assert.equal(chunks[0].chunk.notes.length, 1)
  assert.equal(chunks[1].chunk.notes.length, 0)

  const state = await loadStateOrRebuild()
  assert.equal(state.totalNotes, 1)
  assert.equal(state.nextChunkSequence, 3)

  await resetStore()
  const files = await listChunkFiles()
  assert.equal(files.length, 0)
  const resetState = await loadStateOrRebuild()
  assert.equal(resetState.totalNotes, 0)
  assert.equal(resetState.nextChunkSequence, 1)
})
