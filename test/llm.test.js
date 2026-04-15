const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cmr-memory-llm-'))
process.env.HOME = tmpHome

const { CONFIG_PATH, DEFAULT_CONFIG } = require('../dist/constants')
const { createClient } = require('../dist/llm')
const { loadConfig, saveConfig } = require('../dist/store')

function writeConfig(data) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2))
}

test('createClient returns complete for providers', () => {
  const anthropicClient = createClient({
    ...DEFAULT_CONFIG,
    apiKey: 'test-key',
    provider: 'anthropic'
  })
  assert.equal(typeof anthropicClient.complete, 'function')

  const openaiClient = createClient({
    ...DEFAULT_CONFIG,
    apiKey: 'test-key',
    provider: 'openai',
    model: 'gpt-5.4-nano'
  })
  assert.equal(typeof openaiClient.complete, 'function')
})

test('createClient throws for unknown provider', () => {
  assert.throws(
    () =>
      createClient({
        ...DEFAULT_CONFIG,
        apiKey: 'test-key',
        provider: 'unknown'
      }),
    /Unknown provider/
  )
})

test('config round-trip preserves provider and model', async () => {
  const config = {
    ...DEFAULT_CONFIG,
    provider: 'openai',
    model: 'gpt-5.4-nano'
  }
  await saveConfig(config)
  const loaded = await loadConfig()
  assert.deepEqual(loaded, config)
})

test('loadConfig defaults provider when missing', async () => {
  const raw = { ...DEFAULT_CONFIG }
  delete raw.provider
  writeConfig(raw)

  const loaded = await loadConfig()
  assert.equal(loaded.provider, 'anthropic')
})
