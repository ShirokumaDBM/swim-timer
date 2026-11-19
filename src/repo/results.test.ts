import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { compareSwimmerAverage, findComparableSessions } from '../domain/compare'
import {
  averagesBySwimmer,
  finishSession,
  listFinishedSessions,
  loadAllDetails,
  loadHistory,
  loadSessionDetails,
  loadSummaries,
} from './results'
import { createSession, getSession } from './sessions'
import { addSwimmer } from './swimmers'
import { saveCell } from './times'

let a: string
let b: string

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  a = await addSwimmer({ name: 'A' })
  b = await addSwimmer({ name: 'B' })
})

async function session(date: string, reps: number, times: Record<string, (number | null)[]>, finish = true) {
  const id = await createSession({ date, distance: 50, reps, swimmerIds: [a, b] })
  for (const [swimmerId, list] of Object.entries(times)) {
    for (const [i, v] of list.entries()) await saveCell(id, swimmerId, i + 1, v)
  }
  if (finish) await finishSession(id)
  return id
}

describe('finishSession', () => {
  it('状態が「終了」になる', async () => {
    const id = await session('2026-11-01', 20, {}, false)
    await finishSession(id)
    expect((await getSession(id))!.status).toBe('finished')
  })

  it('削除された測定はエラー', async () => {
    await expect(finishSession('none')).rejects.toThrow('削除されています')
  })
})

describe('averagesBySwimmer', () => {
  it('欠損を除いて平均し、1/100秒に丸める', () => {
    const r = (swimmer: number, rep: number, centis: number | null) => ({ sessionId: '1', swimmerId: String(swimmer), rep, centis })
    const m = averagesBySwimmer([r(1, 1, 3800), r(1, 2, null), r(1, 3, 3801), r(1, 4, 3801), r(2, 1, null)])
    expect(m).toEqual(new Map([['1', 3801]]))
  })
})

describe('loadSummaries', () => {
  it('同じ距離・本数の終了した測定だけ、平均つきで返す', async () => {
    const s1 = await session('2026-11-01', 20, { [a]: [3800, 3900], [b]: [4000] })
    await session('2026-11-02', 30, { [a]: [3000] }) // 本数が違う
    await session('2026-11-03', 20, { [a]: [3000] }, false) // 入力中
    const s4 = await session('2026-11-04', 20, { [a]: [3700, null] })

    const list = await loadSummaries(50, 20)
    expect(list.map((x) => x.session.id).sort()).toEqual([s1, s4].sort())
    const one = list.find((x) => x.session.id === s1)!
    expect(one.averages).toEqual(new Map([[a, 3850], [b, 4000]]))
  })

  it('前回比較：2回目の同条件測定で前回との差が出る', async () => {
    await session('2026-11-01', 20, { [a]: [3800, 3900] }) // 平均 38.50
    const s2 = await session('2026-11-08', 20, { [a]: [3800, 3816] }) // 平均 38.08
    const current = (await getSession(s2))!
    const summaries = await loadSummaries(50, 20)
    const comparable = findComparableSessions(current, summaries)
    const cur = summaries.find((x) => x.session.id === s2)!.averages.get(a)!
    const r = compareSwimmerAverage(a, cur, comparable)
    expect(r.previous).toMatchObject({ date: '2026-11-01', average: 3850, diff: -42 })
  })
})

describe('loadSessionDetails', () => {
  it('同じ条件の終了した測定を、選手ごとの1本ずつのタイムで返す', async () => {
    const s1 = await session('2026-11-01', 3, { [a]: [3800, null, 3900], [b]: [4000] })
    await session('2026-11-02', 4, { [a]: [3000] }) // 本数が違う
    await session('2026-11-03', 3, { [a]: [3000] }, false) // 入力中
    const list = await loadSessionDetails(50, 3)
    expect(list.map((d) => d.session.id)).toEqual([s1])
    expect(list[0].times).toEqual(
      new Map([
        [a, [3800, null, 3900]],
        [b, [4000, null, null]],
      ]),
    )
  })
})

describe('loadAllDetails', () => {
  it('本数の違う測定も入力中の測定も、すべて返す', async () => {
    const s1 = await session('2026-11-01', 3, { [a]: [3800, null, 3900] })
    const s2 = await session('2026-11-02', 2, { [a]: [3000], [b]: [4000, 4100] }, false)
    const list = await loadAllDetails()
    expect(list.map((d) => d.session.id).sort()).toEqual([s1, s2].sort())
    expect(list.find((d) => d.session.id === s1)!.times).toEqual(new Map([[a, [3800, null, 3900]]]))
    expect(list.find((d) => d.session.id === s2)!.times).toEqual(
      new Map([
        [a, [3000, null]],
        [b, [4000, 4100]],
      ]),
    )
  })
})

describe('loadHistory', () => {
  it('すべての測定を新しい順に、入力件数と平均つきで返す', async () => {
    const s1 = await session('2026-11-01', 20, { [a]: [3800, null, 3900], [b]: [4000] })
    const s2 = await session('2026-11-02', 30, {}, false)
    const list = await loadHistory()
    expect(list.map((r) => r.session.id)).toEqual([s2, s1])
    expect(list[1].timeCount).toBe(4)
    expect(list[1].averages).toEqual(new Map([[a, 3850], [b, 4000]]))
    expect(list[0].timeCount).toBe(0)
  })
})

describe('listFinishedSessions', () => {
  it('終了した測定を新しい順に返す', async () => {
    const s1 = await session('2026-11-01', 20, {})
    await session('2026-11-02', 20, {}, false)
    const s3 = await session('2026-11-03', 20, {})
    expect((await listFinishedSessions()).map((s) => s.id)).toEqual([s3, s1])
  })
})
