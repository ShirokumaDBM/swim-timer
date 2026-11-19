import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import {
  BackupError,
  backupFileName,
  currentSummary,
  exportData,
  importData,
  parseBackup,
  summarize,
  type BackupData,
} from './backup'
import { createSession } from './sessions'
import { addSwimmer } from './swimmers'
import { saveCell } from './times'

async function seed() {
  const a = await addSwimmer({ name: '山田', grade: '2年' })
  const b = await addSwimmer({ name: '佐藤' })
  const s = await createSession({ date: '2026-11-07', distance: 50, reps: 3, stroke: 'Fr', swimmerIds: [a, b] }, 100)
  await saveCell(s, a, 1, 3852)
  await saveCell(s, a, 2, null)
  await saveCell(s, b, 1, 3733)
  return { a, b, s }
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('書き出し → 読み込み', () => {
  it('JSON にして戻すと元どおりになる', async () => {
    await seed()
    const before = await exportData(new Date('2026-11-07T12:00:00Z'))
    expect(before.exportedAt).toBe('2026-11-07T12:00:00.000Z')
    expect(summarize(before)).toEqual({ swimmers: 2, sessions: 1, times: 3 })

    const text = JSON.stringify(before)
    await Promise.all(db.tables.map((t) => t.clear()))
    expect(await currentSummary()).toEqual({ swimmers: 0, sessions: 0, times: 0 })

    await importData(parseBackup(text))
    const after = await exportData(new Date('2026-11-07T12:00:00Z'))
    expect(after).toEqual(before)
  })

  it('読み込むと今のデータは置き換わる', async () => {
    await seed()
    const backup = parseBackup(JSON.stringify(await exportData()))
    await addSwimmer({ name: '後から追加' })
    await importData(backup)
    expect((await db.swimmers.orderBy('createdAt').toArray()).map((s) => s.name)).toEqual(['山田', '佐藤'])
  })

  it('読み込み後に追加した選手は、新しい番号で一覧の最後に入る', async () => {
    await seed()
    const backup = parseBackup(JSON.stringify(await exportData()))
    await importData(backup)
    const id = await addSwimmer({ name: '新人' })
    // 新しい番号はランダムなので、読み込んだ選手の番号とぶつからない
    expect(backup.swimmers.map((s) => s.id)).not.toContain(id)
    expect((await db.swimmers.orderBy('createdAt').last())!.id).toBe(id)
  })
})

describe('parseBackup のチェック', () => {
  let good: BackupData
  beforeEach(async () => {
    await seed()
    good = await exportData()
  })
  const broken = (patch: (d: BackupData) => unknown) => {
    const d = structuredClone(good)
    patch(d)
    return JSON.stringify(d)
  }

  it.each([
    ['JSON でない', () => 'not json', 'JSON'],
    ['別のファイル', () => JSON.stringify({ hello: 1 }), 'このアプリのバックアップ'],
    ['新しいバージョン', () => broken((d) => (d.version = 99)), '新しいバージョン'],
    ['一覧がない', () => broken((d) => delete (d as Partial<BackupData>).times), '一覧'],
    ['選手名が空', () => broken((d) => (d.swimmers[0].name = '')), '選手 1件目'],
    ['測定の本数が不正', () => broken((d) => (d.sessions[0].reps = 0)), '測定 1件目'],
    ['レーンが範囲外', () => broken((d) => (d.sessions[0].lanes = d.sessions[0].swimmerIds.map(() => 6))), '測定 1件目'],
    ['レーンの数が選手数と違う', () => broken((d) => (d.sessions[0].lanes = [1])), '測定 1件目'],
    ['タイムが小数',() => broken((d) => (d.times[0].centis = 38.52)), 'タイム 1件目'],
    ['存在しない選手', () => broken((d) => d.sessions[0].swimmerIds.push('none')), '存在しない選手'],
    ['存在しない測定', () => broken((d) => (d.times[0].sessionId = 'none')), '存在しない測定'],
    ['本数を超えるタイム', () => broken((d) => (d.times[0].rep = 4)), '存在しない測定'],
    ['タイムの重複', () => broken((d) => d.times.push({ ...d.times[0] })), '重複'],
    ['選手番号の重複', () => broken((d) => d.swimmers.push({ ...d.swimmers[0], name: 'X' })), '重複'],
  ])('%s', (_, make, msg) => {
    expect(() => parseBackup(make())).toThrow(BackupError)
    expect(() => parseBackup(make())).toThrow(msg)
  })

  it('クラウドと同期している端末では読み込めない（今のデータは変わらない）', async () => {
    await db.meta.put({ key: 'cloud:linked', value: true })
    const before = await currentSummary()
    await expect(importData(parseBackup(JSON.stringify(good)))).rejects.toThrow('クラウドと同期している')
    expect(await currentSummary()).toEqual(before)
  })

  it('チェックに失敗したら今のデータは変わらない', async () => {
    const before = await currentSummary()
    expect(() => parseBackup(broken((d) => (d.times[0].rep = 99)))).toThrow()
    expect(await currentSummary()).toEqual(before)
  })
})

describe('backupFileName', () => {
  it('日時入りのファイル名', () => {
    expect(backupFileName(new Date(2026, 10, 7, 9, 5))).toBe('swim-timer-backup-2026-11-07-0905.json')
  })
})
