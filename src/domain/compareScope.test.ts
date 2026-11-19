import { describe, expect, it } from 'vitest'
import {
  compareWithScope,
  findComparableSessions,
  meanMetrics,
  meanSeries,
  metricsOf,
  scopeDetails,
  type SessionDetail,
} from './compare'
import type { RepTimes } from './types'

const detail = (id: number, date: string, times: Record<number, RepTimes>, reps = 4): SessionDetail => ({
  session: { id: String(id), date, distance: 50, reps, status: 'finished', createdAt: id },
  times: new Map(Object.entries(times)),
})

describe('metricsOf', () => {
  it('平均・ベスト・ワースト・ばらつき・前半後半・落ち幅', () => {
    expect(metricsOf([3800, 3800, 3900, 4000])).toEqual({
      average: 3875,
      best: 3800,
      worst: 4000,
      stdDev: 83,
      firstHalf: 3800,
      secondHalf: 3950,
      fade: 150,
    })
  })

  it('本数が奇数なら前半が1本少ない。休んだ本は除く', () => {
    const m = metricsOf([3800, null, 3900, 4000, 4100])
    expect(m.firstHalf).toBe(3800)
    expect(m.secondHalf).toBe(4000)
  })

  it('記録がなければ null', () => {
    expect(metricsOf([null, null])).toMatchObject({ average: null, best: null, firstHalf: null, fade: null })
  })
})

describe('meanMetrics / meanSeries', () => {
  it('値のある回だけで平均する', () => {
    const m = meanMetrics([metricsOf([3800, 3900]), metricsOf([4000, 4100]), metricsOf([null, null])])
    expect(m.average).toBe(3950)
    expect(m.best).toBe(3900)
    expect(m.fade).toBe(100)
  })

  it('何本目ごとの平均（その本の記録がある回だけ）', () => {
    expect(meanSeries([[3800, 3900, null], [4000, null, null]], 3)).toEqual([3900, 3900, null])
  })
})

describe('scopeDetails / compareWithScope', () => {
  // 今回は 11/20。過去は新しい順に 11/13・11/06・10/30。選手2は 11/13 に不参加
  const current = detail(9, '2026-11-20', {})
  const all = [
    detail(1, '2026-10-30', { 1: [4000, 4000, 4000, 4000], 2: [4200, 4200, 4200, 4200] }),
    detail(2, '2026-11-06', { 1: [3900, 3900, 3900, 3900], 2: [4100, 4100, 4100, 4100] }),
    detail(3, '2026-11-13', { 1: [3800, 3800, 3900, 3900], 2: [null, null, null, null] }),
    detail(4, '2026-11-14', { 1: [3000, 3000, 3000, 3000] }, 6), // 本数が違う
  ]
  const comparable = findComparableSessions(current.session, all)

  it('前回：その選手が参加した直近の測定', () => {
    expect(scopeDetails('2026-11-20', comparable, 'previous', '1').map((d) => d.session.id)).toEqual(['3'])
    expect(scopeDetails('2026-11-20', comparable, 'previous', '2').map((d) => d.session.id)).toEqual(['2'])
  })

  it('同じ月：今回と同じ年月の測定だけ', () => {
    expect(scopeDetails('2026-11-20', comparable, 'month', '1').map((d) => d.session.id)).toEqual(['3', '2'])
  })

  it('これまで全部（条件が違う測定は入らない）', () => {
    expect(scopeDetails('2026-11-20', comparable, 'all', '1').map((d) => d.session.id)).toEqual(['3', '2', '1'])
  })

  it('前回との比較：指標の差と、前回の1本ごとのタイム', () => {
    const r = compareWithScope('1', [3700, 3700, 3800, 3800], '2026-11-20', comparable, 'previous')
    expect(r.current.average).toBe(3750)
    expect(r.reference!.average).toBe(3850)
    expect(r.diff).toMatchObject({ average: -100, best: -100, worst: -100, fade: 0 })
    expect(r.series).toEqual([3800, 3800, 3900, 3900])
    expect(r.sessions).toEqual([{ id: '3', date: '2026-11-13' }])
  })

  it('全期間との比較：各回の指標の平均、何本目ごとの平均', () => {
    const r = compareWithScope('1', [3700, 3700, 3800, 3800], '2026-11-20', comparable, 'all')
    expect(r.reference!.average).toBe(3917) // (3850 + 3900 + 4000) / 3
    expect(r.diff!.average).toBe(-167)
    expect(r.series).toEqual([3900, 3900, 3933, 3933])
    expect(r.sessions).toHaveLength(3)
  })

  it('相手がなければ今回の指標だけ', () => {
    const r = compareWithScope('3', [3700, 3800], '2026-11-20', comparable, 'all')
    expect(r).toMatchObject({ reference: null, diff: null, series: null, sessions: [] })
    expect(r.current.average).toBe(3750)
  })
})
