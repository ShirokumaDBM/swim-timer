import { describe, expect, it } from 'vitest'
import { repSeries, timeDomain, timeTicks, toggleSlot } from './chart'

describe('repSeries', () => {
  it('本数・タイム・前の本との差の点にする（欠損は null）', () => {
    expect(repSeries([3733, 3852, null, 3800])).toEqual([
      { rep: 1, time: 3733, diff: null },
      { rep: 2, time: 3852, diff: 119 },
      { rep: 3, time: null, diff: null },
      { rep: 4, time: 3800, diff: null },
    ])
  })
})

describe('toggleSlot', () => {
  it('加えると空いている一番若い色、外しても残りの色は変わらない', () => {
    let list = toggleSlot([], 10)
    list = toggleSlot(list, 20)
    list = toggleSlot(list, 30)
    expect(list).toEqual([{ id: 10, slot: 0 }, { id: 20, slot: 1 }, { id: 30, slot: 2 }])
    list = toggleSlot(list, 20) // 外す
    expect(list).toEqual([{ id: 10, slot: 0 }, { id: 30, slot: 2 }])
    list = toggleSlot(list, 40) // 空いた色1を使う
    expect(list).toEqual([{ id: 10, slot: 0 }, { id: 30, slot: 2 }, { id: 40, slot: 1 }])
  })

  it('上限を超えては加えない', () => {
    const list = toggleSlot(toggleSlot([], 1, 2), 2, 2)
    expect(toggleSlot(list, 3, 2)).toEqual(list)
  })
})

describe('timeTicks', () => {
  it('きりのよい刻みで8個以内', () => {
    expect(timeTicks([3650, 3950])).toEqual([3650, 3700, 3750, 3800, 3850, 3900, 3950])
    expect(timeTicks([3700, 3900])).toEqual([3700, 3750, 3800, 3850, 3900])
    expect(timeTicks([3500, 4500])).toEqual([3600, 3800, 4000, 4200, 4400])
    expect(timeTicks([3750, 3850])).toEqual([3750, 3775, 3800, 3825, 3850])
  })
})

describe('timeDomain', () => {
  it('上下に余白を取り 0.5秒刻みに揃える', () => {
    // 37.33〜38.52 → 37.00〜39.00
    expect(timeDomain([3733, 3852, null])).toEqual([3700, 3900])
  })

  it('1本だけでも幅がある', () => {
    expect(timeDomain([3800])).toEqual([3750, 3850])
  })

  it('記録がなければ null', () => {
    expect(timeDomain([null, null])).toBeNull()
  })
})
