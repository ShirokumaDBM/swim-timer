import { parseTimeInput } from './time'
import type { Centis, RepTimes, TimeRecord } from './types'

/**
 * 入力表の1マスの値
 *  - number    : タイム（1/100秒）
 *  - null      : 欠損（その本を休んだ。入力済み扱い）
 *  - undefined : 未入力
 */
export type CellValue = Centis | null | undefined

/** grid[選手の行][本の列]（列 0 が1本目） */
export type Grid = CellValue[][]

export function buildGrid(swimmerIds: number[], reps: number, records: TimeRecord[]): Grid {
  const rowOf = new Map(swimmerIds.map((id, i) => [id, i]))
  const grid: Grid = swimmerIds.map(() => Array<CellValue>(reps).fill(undefined))
  for (const rec of records) {
    const r = rowOf.get(rec.swimmerId)
    if (r === undefined || rec.rep < 1 || rec.rep > reps) continue
    grid[r][rec.rep - 1] = rec.centis
  }
  return grid
}

/** 計算用のタイム列（未入力・欠損はどちらも null） */
export function toRepTimes(row: CellValue[]): RepTimes {
  return row.map((v) => (v === undefined ? null : v))
}

export const isFilled = (v: CellValue) => v !== undefined

export function filledMatrix(grid: Grid): boolean[][] {
  return grid.map((row) => row.map(isFilled))
}

// ---------- 入力の解釈 ----------

export type CellInput =
  | { kind: 'time'; centis: Centis }
  | { kind: 'missing' }
  | { kind: 'clear' }
  | { kind: 'invalid' }

const MISSING_WORDS = new Set(['-', 'ー', '－', '―', 'x', 'dns', '休'])

/** マスへの入力文字列を解釈する。空 = 消去、"-" や "x" = 欠損 */
export function parseCellInput(text: string): CellInput {
  const s = text.trim()
  if (s === '') return { kind: 'clear' }
  if (MISSING_WORDS.has(s.toLowerCase()) || s === '—') return { kind: 'missing' }
  const centis = parseTimeInput(s)
  if (centis === null || centis <= 0) return { kind: 'invalid' }
  return { kind: 'time', centis }
}

/** 解釈済みの入力をマスの値にする（invalid は呼び出し側で先に除外する） */
export function cellValueOf(input: Exclude<CellInput, { kind: 'invalid' }>): CellValue {
  switch (input.kind) {
    case 'time':
      return input.centis
    case 'missing':
      return null
    case 'clear':
      return undefined
  }
}

// ---------- カーソル移動 ----------

/** Enter で進む向き: 'byRep' = 本数順（同じ本の次の選手 → 下へ） / 'bySwimmer' = 選手順（同じ選手の次の本 → 右へ） */
export type InputOrder = 'byRep' | 'bySwimmer'

export interface Pos {
  row: number
  col: number
}

/** 入力順で次（step=1）／前（step=-1）のマス。端を越えたら null */
export function stepCell(pos: Pos, step: 1 | -1, rows: number, cols: number, order: InputOrder): Pos | null {
  // 入力順に並べたときの通し番号に変換して ±1 する
  const index = order === 'byRep' ? pos.col * rows + pos.row : pos.row * cols + pos.col
  const next = index + step
  if (next < 0 || next >= rows * cols) return null
  return order === 'byRep'
    ? { row: next % rows, col: Math.floor(next / rows) }
    : { row: Math.floor(next / cols), col: next % cols }
}

/** 矢印キーでの移動（端では止まる） */
export function moveCell(pos: Pos, key: 'up' | 'down' | 'left' | 'right', rows: number, cols: number): Pos {
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max - 1)
  switch (key) {
    case 'up':
      return { row: clamp(pos.row - 1, rows), col: pos.col }
    case 'down':
      return { row: clamp(pos.row + 1, rows), col: pos.col }
    case 'left':
      return { row: pos.row, col: clamp(pos.col - 1, cols) }
    case 'right':
      return { row: pos.row, col: clamp(pos.col + 1, cols) }
  }
}

/** 入力順で最初の未入力マス（全部埋まっていれば null） */
export function firstEmptyCell(grid: Grid, order: InputOrder): Pos | null {
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  if (rows === 0 || cols === 0) return null
  let pos: Pos | null = { row: 0, col: 0 }
  while (pos) {
    if (!isFilled(grid[pos.row][pos.col])) return pos
    pos = stepCell(pos, 1, rows, cols, order)
  }
  return null
}
