import { diffsFromPrevious } from './stats'
import type { Centis, RepTimes } from './types'

export interface RepPoint {
  /** 何本目か（1始まり） */
  rep: number
  /** 未入力・欠損は null（グラフの線はそこで途切れる） */
  time: Centis | null
  /** 前の本との差 */
  diff: Centis | null
}

/** 1人分のタイム列をグラフ用の点にする */
export function repSeries(times: RepTimes): RepPoint[] {
  const diffs = diffsFromPrevious(times)
  return times.map((time, i) => ({ rep: i + 1, time, diff: diffs[i] }))
}

/**
 * 縦軸の範囲（1/100秒）。上下に少し余白を取り、0.5秒刻みに揃える。
 * 記録がなければ null。
 */
export function timeDomain(times: RepTimes, step: Centis = 50): [Centis, Centis] | null {
  const xs = times.filter((t): t is Centis => t != null)
  if (xs.length === 0) return null
  const min = Math.min(...xs)
  const max = Math.max(...xs)
  const lo = Math.floor((min - step / 2) / step) * step
  const hi = Math.ceil((max + step / 2) / step) * step
  return [Math.max(0, lo), hi]
}

/** 重ねて比べられる人数（色の数） */
export const MAX_COMPARE = 8

/** 重ねグラフに出す選手と、その選手の色番号 */
export interface SlotEntry {
  id: number
  slot: number
}

/**
 * 選手を重ねグラフに出す／外す。
 * 色は選手についていく：外しても残りの選手の色は変わらず、加えた選手には空いている一番若い色を使う。
 * すでに max 人なら加えない。
 */
export function toggleSlot(list: readonly SlotEntry[], id: number, max = MAX_COMPARE): SlotEntry[] {
  if (list.some((e) => e.id === id)) return list.filter((e) => e.id !== id)
  if (list.length >= max) return [...list]
  const used = new Set(list.map((e) => e.slot))
  let slot = 0
  while (used.has(slot)) slot++
  return [...list, { id, slot }]
}

/** 縦軸の目盛り。0.1 / 0.25 / 0.5 / 1 / 2 / 5秒… のうち、目盛りが maxCount 個以下になる一番細かい刻み */
export function timeTicks([lo, hi]: [Centis, Centis], maxCount = 8): Centis[] {
  const steps = [10, 25, 50, 100, 200, 500, 1000, 3000, 6000]
  const step = steps.find((s) => Math.floor(hi / s) - Math.ceil(lo / s) + 1 <= maxCount) ?? 6000
  const ticks: Centis[] = []
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t)
  return ticks
}
