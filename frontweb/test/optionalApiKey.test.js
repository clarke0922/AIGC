import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')
test('AI config form permits empty keys while retaining required connection fields', () => {
  const expression = source.slice(source.indexOf('const rules = computed(') + 'const rules = computed('.length, source.indexOf('const testVisible')).trim().slice(0, -1)
  const rules = Function(`return (${expression})`)()()
  assert.equal(rules.api_key, undefined)
  for (const key of ['service_type', 'name', 'provider', 'base_url']) assert.equal(rules[key][0].required, true)
  assert.doesNotMatch(source, /prop="api_key"[^>]*:rules=/)
  assert.match(source, /本地模型可留空/)
})
