import { describe, expect, it } from 'vitest'
import { hasLanes, isLane, laneRowOrder } from './lanes'

describe('isLane', () => {
  it('1〜5の整数だけ', () => {
    expect([1, 5].every(isLane)).toBe(true)
    expect([0, 6, 2.5, '3', null].some(isLane)).toBe(false)
  })
})

describe('hasLanes', () => {
  it('1人でも設定があれば true', () => {
    expect(hasLanes(undefined)).toBe(false)
    expect(hasLanes([null, null])).toBe(false)
    expect(hasLanes([null, 2])).toBe(true)
  })
})

describe('laneRowOrder', () => {
  // 元の並び: 0=3レーン, 1=1レーン, 2=未設定, 3=3レーン, 4=5レーン
  const lanes = [3, 1, null, 3, 5]

  it('登録順はそのまま', () => {
    expect(laneRowOrder(lanes, 5, 'entry')).toEqual([0, 1, 2, 3, 4])
  })

  it('昇順：同じレーンは元の順、未設定は最後', () => {
    expect(laneRowOrder(lanes, 5, 'asc')).toEqual([1, 0, 3, 4, 2])
  })

  it('降順：同じレーンは元の順、未設定は最後', () => {
    expect(laneRowOrder(lanes, 5, 'desc')).toEqual([4, 0, 3, 1, 2])
  })

  it('レーンがなければ登録順', () => {
    expect(laneRowOrder(undefined, 3, 'asc')).toEqual([0, 1, 2])
  })
})
