import { describe, expect, it } from 'vitest'
import { average, completedReps, diffsFromPrevious, standardDeviation, swimmerStats } from './stats'
import { formatDiff } from './time'

describe('diffsFromPrevious', () => {
  it('要件の例: 3本目 37.33 → 4本目 38.52 は +1.19', () => {
    const diffs = diffsFromPrevious([3700, 3650, 3733, 3852])
    expect(diffs[3]).toBe(119)
    expect(formatDiff(diffs[3])).toBe('+1.19')
  })

  it('1本目は常に null、速くなればマイナス', () => {
    expect(diffsFromPrevious([3800, 3750, 3750])).toEqual([null, -50, 0])
  })

  it('浮動小数の誤差が出ない（整数で計算）', () => {
    // 秒の小数で計算すると 38.52 - 37.33 = 1.1900000000000013 になる
    expect(diffsFromPrevious([3733, 3852])[1]).toBe(119)
  })

  it('自分か直前が欠損・未入力なら null', () => {
    expect(diffsFromPrevious([3800, null, 3900, 3950])).toEqual([null, null, null, 50])
  })
})

describe('average', () => {
  it('入力済みの本だけで平均を出す', () => {
    expect(average([3800, 3900])).toBe(3850)
    expect(average([3800, null, 3900, null])).toBe(3850)
  })

  it('1本も入力がなければ null', () => {
    expect(average([])).toBeNull()
    expect(average([null, null])).toBeNull()
  })

  it('割り切れない場合は小数のまま返す（表示時に丸める）', () => {
    expect(average([3800, 3801, 3801])).toBeCloseTo(3800.6667, 3)
  })
})

describe('standardDeviation', () => {
  it('母標準偏差', () => {
    expect(standardDeviation([3800, 4000])).toBe(100)
    expect(standardDeviation([3800, 3800, 3800])).toBe(0)
  })

  it('2本未満なら null', () => {
    expect(standardDeviation([3800])).toBeNull()
    expect(standardDeviation([3800, null])).toBeNull()
  })
})

describe('swimmerStats', () => {
  it('平均・ベスト・ワースト・本数・前本差をまとめて返す', () => {
    const s = swimmerStats([3800, 3733, null, 3852])
    expect(s.average).toBeCloseTo((3800 + 3733 + 3852) / 3)
    expect(s.best).toBe(3733)
    expect(s.worst).toBe(3852)
    expect(s.count).toBe(3)
    expect(s.diffs).toEqual([null, -67, null, null])
  })

  it('未入力のみ', () => {
    const s = swimmerStats([null, null])
    expect(s).toMatchObject({ average: null, best: null, worst: null, stdDev: null, count: 0 })
  })
})

describe('completedReps', () => {
  it('全員分が埋まっている本数を数える', () => {
    const filled = [
      [true, true, true, false],
      [true, true, false, false],
    ]
    expect(completedReps(filled, 4)).toBe(2)
  })

  it('全部埋まっていれば N、誰もいなければ N', () => {
    expect(completedReps([[true, true]], 2)).toBe(2)
    expect(completedReps([], 3)).toBe(3)
  })

  it('途中に穴があればそこまで', () => {
    expect(completedReps([[true, false, true]], 3)).toBe(1)
  })
})
