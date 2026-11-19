import { describe, expect, it } from 'vitest'
import { conditionOptions, previousAverage, type HistoryRow } from './history'
import type { Session } from './types'

const row = (
  id: number,
  distance: number,
  reps: number,
  averages: [number, number][],
  status: Session['status'] = 'finished',
): HistoryRow => ({
  session: { id: String(id), date: '2026-11-01', distance, reps, swimmerIds: ['1', '2'], status, createdAt: id },
  timeCount: 0,
  averages: new Map(averages.map(([k, v]) => [String(k), v])),
})

// 新しい順
const rows = [
  row(5, 50, 30, [[1, 3800]]),
  row(4, 50, 30, [[1, 3700]], 'in_progress'), // 入力中は比べない
  row(3, 50, 20, [[1, 3600]]), // 条件が違う
  row(2, 50, 30, [[2, 4000]]), // 選手1は不参加
  row(1, 50, 30, [[1, 3850], [2, 4100]]),
]

describe('previousAverage', () => {
  it('同じ条件・終了済みで、その選手が参加した直近の測定の平均', () => {
    expect(previousAverage(rows, 0, '1')).toBe(3850)
    expect(previousAverage(rows, 0, '2')).toBe(4000)
  })

  it('なければ null', () => {
    expect(previousAverage(rows, 4, '1')).toBeNull()
    expect(previousAverage(rows, 2, '1')).toBeNull()
  })
})

describe('conditionOptions', () => {
  it('回数の多い順', () => {
    expect(conditionOptions(rows).map((o) => [o.key, o.count])).toEqual([
      ['50x30', 4],
      ['50x20', 1],
    ])
  })
})
