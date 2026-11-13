import { describe, expect, it } from 'vitest'
import { compareSwimmerAverage, findComparableSessions, type SessionSummary } from './compare'

let nextId = 1
function summary(
  date: string,
  reps: number,
  averages: Record<number, number>,
  opts: { distance?: number; status?: 'finished' | 'in_progress'; createdAt?: number } = {},
): SessionSummary {
  return {
    session: {
      id: nextId++,
      date,
      distance: opts.distance ?? 50,
      reps,
      status: opts.status ?? 'finished',
      createdAt: opts.createdAt ?? 0,
    },
    averages: new Map(Object.entries(averages).map(([k, v]) => [Number(k), v])),
  }
}

describe('findComparableSessions', () => {
  it('距離・本数が同じ・終了済み・過去のものだけを新しい順で返す', () => {
    const a = summary('2026-10-01', 30, {})
    const b = summary('2026-10-08', 30, {})
    const differentReps = summary('2026-10-10', 20, {})
    const differentDist = summary('2026-10-11', 30, {}, { distance: 100 })
    const unfinished = summary('2026-10-12', 30, {}, { status: 'in_progress' })
    const future = summary('2026-11-20', 30, {})
    const target = summary('2026-11-07', 30, {}, { status: 'in_progress' })

    const result = findComparableSessions(target.session, [
      a, b, differentReps, differentDist, unfinished, future, target,
    ])
    expect(result.map((r) => r.session.id)).toEqual([b.session.id, a.session.id])
  })

  it('同じ日なら作成日時で前後を判定する', () => {
    const morning = summary('2026-11-07', 30, {}, { createdAt: 1000 })
    const target = summary('2026-11-07', 30, {}, { createdAt: 2000 })
    const later = summary('2026-11-07', 30, {}, { createdAt: 3000 })
    const result = findComparableSessions(target.session, [morning, target, later])
    expect(result.map((r) => r.session.id)).toEqual([morning.session.id])
  })
})

describe('compareSwimmerAverage', () => {
  // 新しい順
  const comparable = [
    summary('2026-10-29', 30, { 1: 3850, 2: 3600 }),
    summary('2026-10-22', 30, { 1: 3790 }), // 選手1のベスト
    summary('2026-10-15', 30, { 1: 3900, 2: 3650 }),
    summary('2026-10-08', 30, { 1: 4000 }),
  ]

  it('前回・ベスト・直近3回と比べる（マイナス = 速くなった）', () => {
    const r = compareSwimmerAverage(1, 3808, comparable)
    expect(r.previous).toMatchObject({ date: '2026-10-29', average: 3850, diff: -42 })
    expect(r.best).toMatchObject({ date: '2026-10-22', average: 3790, diff: 18 })
    expect(r.recent?.count).toBe(3)
    expect(r.recent?.average).toBe(Math.round((3850 + 3790 + 3900) / 3))
  })

  it('その選手が参加していない回は飛ばす', () => {
    const r = compareSwimmerAverage(2, 3620, comparable)
    expect(r.previous).toMatchObject({ date: '2026-10-29', diff: 20 })
    expect(r.recent?.count).toBe(2)
  })

  it('過去データがなければすべて null', () => {
    const r = compareSwimmerAverage(99, 3800, comparable)
    expect(r).toEqual({ current: 3800, previous: null, best: null, recent: null })
  })
})
