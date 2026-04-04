const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cmr-memory-store-'))
process.env.HOME = tmpHome

const { CONFIG_PATH, DEFAULT_CONFIG } = require('../dist/constants')
const {
  appendNote,
  createNote,
  detectConfigDrift,
  listChunkFiles,
  loadChunks,
  loadRawConfig,
  loadStateOrRebuild,
  resetStore
} = require('../dist/store')

function writeConfig(data) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2))
}

function removeConfig() {
  fs.rmSync(CONFIG_PATH, { force: true })
}

test('detectConfigDrift returns false when raw matches parsed', () => {
  const parsed = { ...DEFAULT_CONFIG, apiKey: 'test-key' }
  const raw = { ...parsed }
  assert.equal(detectConfigDrift(raw, parsed), false)
})

test('detectConfigDrift returns true when raw is missing a field', () => {
  const parsed = { ...DEFAULT_CONFIG, apiKey: 'test-key' }
  const raw = { ...parsed }
  delete raw.model
  assert.equal(detectConfigDrift(raw, parsed), true)
})

test('detectConfigDrift returns true when raw has extra fields', () => {
  const parsed = { ...DEFAULT_CONFIG, apiKey: 'test-key' }
  const raw = { ...parsed, extra: true }
  assert.equal(detectConfigDrift(raw, parsed), true)
})

test('detectConfigDrift returns true when values differ', () => {
  const parsed = { ...DEFAULT_CONFIG, apiKey: 'test-key' }
  const raw = { ...parsed, maxHints: parsed.maxHints + 1 }
  assert.equal(detectConfigDrift(raw, parsed), true)
})

test('loadRawConfig returns raw object from disk', async () => {
  removeConfig()
  const raw = { ...DEFAULT_CONFIG, apiKey: 'disk-key', extra: 'value' }
  writeConfig(raw)
  const loaded = await loadRawConfig()
  assert.deepEqual(loaded, raw)
})

test('loadRawConfig returns null when config file missing', async () => {
  removeConfig()
  const loaded = await loadRawConfig()
  assert.equal(loaded, null)
})

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
