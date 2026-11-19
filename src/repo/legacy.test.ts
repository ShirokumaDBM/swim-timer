import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { convertLegacy } from '../domain/legacy'
import { parseBackup } from './backup'
import { migrateLegacyData } from './legacy'
import { listSwimmers } from './swimmers'

/** 以前の形式（番号が連番）のデータ */
const legacy = {
  swimmers: [
    { id: 1, name: '山田', grade: '2年' },
    { id: 2, name: '佐藤' },
    { id: 4, name: '鈴木' },
  ],
  sessions: [
    {
      id: 1,
      date: '2026-11-01',
      distance: 50,
      reps: 3,
      stroke: 'Fr',
      // 3 は削除済みの選手
      swimmerIds: [2, 1, 3],
      lanes: [1, 2, null],
      status: 'finished' as const,
      createdAt: 100,
    },
    { id: 2, date: '2026-11-08', distance: 50, reps: 3, swimmerIds: [1], status: 'in_progress' as const, createdAt: 200 },
  ],
  times: [
    { sessionId: 1, swimmerId: 1, rep: 1, centis: 3852 },
    { sessionId: 1, swimmerId: 1, rep: 2, centis: null },
    { sessionId: 1, swimmerId: 2, rep: 1, centis: 4000 },
    { sessionId: 2, swimmerId: 1, rep: 1, centis: 3800 },
    { sessionId: 9, swimmerId: 1, rep: 1, centis: 9999 }, // 存在しない測定
  ],
}

/** テスト用に、決まった順番の番号を返す */
function counter() {
  let n = 0
  return () => `id-${++n}`
}

describe('convertLegacy', () => {
  const out = convertLegacy(legacy, counter())
  const idOf = (name: string) => out.swimmers.find((s) => s.name === name)!.id

  it('選手：名前・学年はそのまま、登録順は元の番号の順', () => {
    expect(out.swimmers.map((s) => [s.name, s.grade, s.createdAt])).toEqual([
      ['山田', '2年', 1],
      ['佐藤', undefined, 2],
      ['鈴木', undefined, 4],
    ])
    expect(new Set(out.swimmers.map((s) => s.id)).size).toBe(3)
  })

  it('測定：参加選手の並び・レーン・状態はそのままで、番号だけ新しくなる', () => {
    const [s1, s2] = out.sessions
    expect(s1).toMatchObject({ date: '2026-11-01', distance: 50, reps: 3, stroke: 'Fr', lanes: [1, 2, null], status: 'finished', createdAt: 100 })
    expect(s1.swimmerIds.slice(0, 2)).toEqual([idOf('佐藤'), idOf('山田')])
    // 削除済みの選手にも番号を割り当てる（どの選手とも重ならない）
    expect(out.swimmers.map((s) => s.id)).not.toContain(s1.swimmerIds[2])
    expect(s2.swimmerIds).toEqual([idOf('山田')])
    expect(s1.id).not.toBe(s2.id)
  })

  it('タイム：同じ測定・選手・本数に付く。存在しない測定のタイムは捨てる', () => {
    const [s1, s2] = out.sessions
    expect(out.times).toEqual([
      { sessionId: s1.id, swimmerId: idOf('山田'), rep: 1, centis: 3852 },
      { sessionId: s1.id, swimmerId: idOf('山田'), rep: 2, centis: null },
      { sessionId: s1.id, swimmerId: idOf('佐藤'), rep: 1, centis: 4000 },
      { sessionId: s2.id, swimmerId: idOf('山田'), rep: 1, centis: 3800 },
    ])
  })
})

describe('以前の形式のバックアップファイル', () => {
  it('版1のファイルも読み込める（新しい番号に変換される）', () => {
    const file = JSON.stringify({
      format: 'swim-timer-backup',
      version: 1,
      exportedAt: '2026-11-08T00:00:00.000Z',
      swimmers: legacy.swimmers.slice(0, 2),
      sessions: [{ ...legacy.sessions[0], swimmerIds: [2, 1], lanes: [1, 2] }],
      times: legacy.times.slice(0, 3),
    })
    const data = parseBackup(file, counter())
    expect(data.version).toBe(2)
    expect(data.swimmers.map((s) => s.name)).toEqual(['山田', '佐藤'])
    const yamada = data.swimmers[0].id
    expect(data.sessions[0].swimmerIds).toEqual([data.swimmers[1].id, yamada])
    expect(data.times.filter((t) => t.swimmerId === yamada).map((t) => t.centis)).toEqual([3852, null])
  })
})

describe('migrateLegacyData', () => {
  /** 以前のアプリが作っていたのと同じ形のデータベースを作る */
  async function createOldDatabase(data = legacy) {
    const old = new Dexie('swim-timer')
    old.version(2).stores({
      swimmers: '++id, name',
      sessions: '++id, date, [distance+reps], status',
      times: '[sessionId+swimmerId+rep], sessionId, swimmerId',
    })
    await old.open()
    await old.table('swimmers').bulkAdd(data.swimmers)
    await old.table('sessions').bulkAdd(data.sessions)
    await old.table('times').bulkAdd(data.times)
    old.close()
  }

  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
    await Dexie.delete('swim-timer')
  })

  it('以前の記録が今のデータベースに写る。旧データベースは残る', async () => {
    await createOldDatabase()
    expect(await migrateLegacyData()).toBe('migrated')

    expect((await listSwimmers()).map((s) => s.name)).toEqual(['山田', '佐藤', '鈴木'])
    expect(await db.sessions.count()).toBe(2)
    expect(await db.times.count()).toBe(4)
    // 山田の 11/01 のタイムが、山田に付いたまま読める
    const yamada = (await listSwimmers())[0].id
    const s1 = (await db.sessions.toArray()).find((s) => s.date === '2026-11-01')!
    const times = await db.times.where({ sessionId: s1.id, swimmerId: yamada }).sortBy('rep')
    expect(times.map((t) => t.centis)).toEqual([3852, null])

    // 旧データベースは消していない
    expect(await Dexie.exists('swim-timer')).toBe(true)
    const old = new Dexie('swim-timer')
    await old.open()
    expect(await old.table('swimmers').count()).toBe(3)
    old.close()
  })

  it('2回目以降は何もしない（二重に写さない）', async () => {
    await createOldDatabase()
    await migrateLegacyData()
    expect(await migrateLegacyData()).toBe('already')
    expect(await db.swimmers.count()).toBe(3)
  })

  it('今のデータベースにすでに記録があれば、上書きしない', async () => {
    await createOldDatabase()
    await db.swimmers.add({ id: 'x', name: '新しい選手', createdAt: 1 })
    expect(await migrateLegacyData()).toBe('nothing')
    expect((await listSwimmers()).map((s) => s.name)).toEqual(['新しい選手'])
  })

  it('以前の記録がなければ何もしない', async () => {
    expect(await migrateLegacyData()).toBe('nothing')
    expect(await db.swimmers.count()).toBe(0)
  })
})
