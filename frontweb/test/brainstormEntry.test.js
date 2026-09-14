import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/views/FilmList.vue', import.meta.url), 'utf8')

test('story home exposes KSR brainstorm image entry with 2K and 4K choices', () => {
  assert.match(source, /<div class="header-actions">\s*<el-button[^>]*class="btn-brainstorm"[^>]*>\s*<el-icon><MagicStick\s*\/><\/el-icon>头脑风暴/)
  assert.match(source, /title="头脑风暴 · KSR电影感出图"/)
  assert.match(source, /<el-radio-button label="2k">2K<\/el-radio-button>/)
  assert.match(source, /<el-radio-button label="4k">4K<\/el-radio-button>/)
  assert.match(source, /brainstormAPI\.listModels/)
  assert.match(source, /v-model="brainstormForm\.models"/)
  assert.match(source, /multiple/)
  assert.match(source, /每个模型各生成 1 张/)
  assert.match(source, /class="brainstorm-candidates"/)
  assert.match(source, /brainstormAPI\.generateImage/)
  assert.match(source, /downloadBrainstormImage/)
})
