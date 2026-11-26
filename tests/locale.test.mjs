import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const code = await readFile(new URL('../client.js', import.meta.url), 'utf8')
/** Keys of one dictionary literal: `name: '…'` entries between its opening line and the next dictionary. */
function keys(start, end) {
  const from = code.indexOf(start), to = code.indexOf(end, from + start.length)
  assert.ok(from >= 0 && to > from, `${start} not found`)
  return [...code.slice(from, to).matchAll(/(?:^\s*|[,{]\s*)([A-Za-z0-9_]+|'[^']+'):\s*['`]/gm)].map((m) => m[1].replace(/'/g, ''))
}

test('every dictionary has the same keys in Chinese and English, and keys stay ASCII', () => {
  for (const [zh, en, tail] of [['const zh = {', 'const en = {', '\n    }\n'], ['const notesZh = {', 'const notesEn = {', '\n    }\n'], ['const projectsZh = {', 'const projectsEn = {', '\n    }\n']]) {
    const z = keys(zh, en), e = keys(en, tail)
    assert.ok(z.length > 20, `${zh} parsed`)
    assert.deepEqual([...new Set(z)].filter((key) => !e.includes(key)), [], `${zh} keys missing in English`)
    assert.deepEqual([...new Set(e)].filter((key) => !z.includes(key)), [], `${en} keys missing in Chinese`)
    assert.deepEqual(z.filter((key) => /[^\x00-\x7f]/.test(key)), [], 'a translation pass must never rename a key')
  }
})

test('Chinese copy uses DSH\'s own words: 会话 and 工作区, not Session or Workspace', () => {
  for (const [start, end] of [['const zh = {', 'const en = {'], ['const notesZh = {', 'const notesEn = {'], ['const projectsZh = {', 'const projectsEn = {']]) {
    const block = code.slice(code.indexOf(start), code.indexOf(end))
    const values = [...block.matchAll(/:\s*'([^']*)'/g)].map((m) => m[1])
    assert.deepEqual(values.filter((value) => /\b(Session|Workspace|Host)\b/.test(value)), [])
  }
})
