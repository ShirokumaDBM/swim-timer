/** レーン番号（1〜5） */
export const LANES = [1, 2, 3, 4, 5] as const
export const MAX_LANE = LANES.length

export const isLane = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_LANE

/** 入力表の並び順：登録順／レーン昇順／レーン降順 */
export type LaneOrder = 'entry' | 'asc' | 'desc'

/** レーンが1人でも設定されているか */
export function hasLanes(lanes: readonly (number | null)[] | undefined): boolean {
  return !!lanes?.some((l) => l != null)
}

/**
 * 表示する行の順番（元の並びのインデックス）を返す。
 * 同じレーンの選手は元の順番のまま。レーン未設定の選手は昇順・降順どちらでも最後。
 */
export function laneRowOrder(lanes: readonly (number | null)[] | undefined, count: number, order: LaneOrder): number[] {
  const rows = Array.from({ length: count }, (_, i) => i)
  if (order === 'entry' || !hasLanes(lanes)) return rows
  const sign = order === 'asc' ? 1 : -1
  return rows.sort((a, b) => {
    const la = lanes![a] ?? null
    const lb = lanes![b] ?? null
    if (la === lb) return a - b
    if (la == null) return 1
    if (lb == null) return -1
    return (la - lb) * sign
  })
}
