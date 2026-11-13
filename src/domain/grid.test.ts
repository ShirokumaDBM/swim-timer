import { describe, expect, it } from 'vitest'
import {
  buildGrid,
  filledMatrix,
  firstEmptyCell,
  moveCell,
  parseCellInput,
  stepCell,
  toRepTimes,
  type Grid,
} from './grid'

describe('buildGrid', () => {
  it('記録を選手の行・本の列に並べる（未入力は undefined、欠損は null）', () => {
    const grid = buildGrid([10, 20], 3, [
      { sessionId: 1, swimmerId: 20, rep: 2, centis: 3852 },
      { sessionId: 1, swimmerId: 10, rep: 1, centis: 3733 },
      { sessionId: 1, swimmerId: 10, rep: 3, centis: null },
      { sessionId: 1, swimmerId: 99, rep: 1, centis: 1 }, // 参加していない選手は無視
      { sessionId: 1, swimmerId: 10, rep: 4, centis: 1 }, // 範囲外は無視
    ])
    expect(grid).toEqual([
      [3733, undefined, null],
      [undefined, 3852, undefined],
    ])
  })

  it('toRepTimes / filledMatrix', () => {
    const row = [3733, undefined, null]
    expect(toRepTimes(row)).toEqual([3733, null, null])
    expect(filledMatrix([row])).toEqual([[true, false, true]])
  })
})

describe('parseCellInput', () => {
  it.each([
    ['3852', { kind: 'time', centis: 3852 }],
    ['1:05.23', { kind: 'time', centis: 6523 }],
    ['', { kind: 'clear' }],
    ['  ', { kind: 'clear' }],
    ['-', { kind: 'missing' }],
    ['x', { kind: 'missing' }],
    ['X', { kind: 'missing' }],
    ['DNS', { kind: 'missing' }],
    ['ー', { kind: 'missing' }],
    ['—', { kind: 'missing' }],
    ['abc', { kind: 'invalid' }],
    ['0', { kind: 'invalid' }],
    ['1:75', { kind: 'invalid' }],
  ])('"%s" → %o', (text, expected) => {
    expect(parseCellInput(text)).toEqual(expected)
  })
})

describe('stepCell', () => {
  // 3人 × 2本
  it('本数順: 下へ進み、最後の選手の次は次の本の先頭', () => {
    expect(stepCell({ row: 0, col: 0 }, 1, 3, 2, 'byRep')).toEqual({ row: 1, col: 0 })
    expect(stepCell({ row: 2, col: 0 }, 1, 3, 2, 'byRep')).toEqual({ row: 0, col: 1 })
    expect(stepCell({ row: 2, col: 1 }, 1, 3, 2, 'byRep')).toBeNull()
    expect(stepCell({ row: 0, col: 1 }, -1, 3, 2, 'byRep')).toEqual({ row: 2, col: 0 })
  })

  it('選手順: 右へ進み、最後の本の次は次の選手の1本目', () => {
    expect(stepCell({ row: 0, col: 0 }, 1, 3, 2, 'bySwimmer')).toEqual({ row: 0, col: 1 })
    expect(stepCell({ row: 0, col: 1 }, 1, 3, 2, 'bySwimmer')).toEqual({ row: 1, col: 0 })
    expect(stepCell({ row: 0, col: 0 }, -1, 3, 2, 'bySwimmer')).toBeNull()
  })
})

describe('moveCell', () => {
  it('矢印キーで移動し、端では止まる', () => {
    expect(moveCell({ row: 1, col: 1 }, 'up', 3, 3)).toEqual({ row: 0, col: 1 })
    expect(moveCell({ row: 0, col: 1 }, 'up', 3, 3)).toEqual({ row: 0, col: 1 })
    expect(moveCell({ row: 2, col: 2 }, 'right', 3, 3)).toEqual({ row: 2, col: 2 })
    expect(moveCell({ row: 2, col: 2 }, 'left', 3, 3)).toEqual({ row: 2, col: 1 })
    expect(moveCell({ row: 1, col: 0 }, 'down', 3, 3)).toEqual({ row: 2, col: 0 })
  })
})

describe('firstEmptyCell', () => {
  const grid: Grid = [
    [1, 1, undefined],
    [1, undefined, undefined],
  ]
  it('入力順で最初の未入力マス', () => {
    expect(firstEmptyCell(grid, 'byRep')).toEqual({ row: 1, col: 1 })
    expect(firstEmptyCell(grid, 'bySwimmer')).toEqual({ row: 0, col: 2 })
  })

  it('欠損は入力済みとみなす。全部埋まっていれば null', () => {
    expect(firstEmptyCell([[1, null]], 'byRep')).toBeNull()
    expect(firstEmptyCell([], 'byRep')).toBeNull()
  })
})
