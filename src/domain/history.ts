import type { Centis, Session } from './types'

/** 履歴の1行：測定 + 入力済みのタイム件数 + 各選手の平均 */
export interface HistoryRow {
  session: Session
  /** 入力済みのマス（欠損も含む）の件数 */
  timeCount: number
  /** swimmerId → 平均タイム（1/100秒に丸め済み） */
  averages: Map<number, Centis>
}

/** 比較の条件（距離・本数）を表すキー */
export function conditionKey(s: Pick<Session, 'distance' | 'reps'>): string {
  return `${s.distance}x${s.reps}`
}

export interface ConditionOption {
  key: string
  distance: number
  reps: number
  count: number
}

/** 履歴に出てくる条件の一覧（回数の多い順、同じなら距離・本数の順） */
export function conditionOptions(rows: readonly HistoryRow[]): ConditionOption[] {
  const map = new Map<string, ConditionOption>()
  for (const { session: s } of rows) {
    const key = conditionKey(s)
    const o = map.get(key) ?? { key, distance: s.distance, reps: s.reps, count: 0 }
    o.count += 1
    map.set(key, o)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.distance - b.distance || a.reps - b.reps)
}

/**
 * rows（新しい順）の index 行目について、その選手の「前回」（同じ条件・終了済み・より前）の平均。
 * なければ null。
 */
export function previousAverage(rows: readonly HistoryRow[], index: number, swimmerId: number): Centis | null {
  const key = conditionKey(rows[index].session)
  for (let j = index + 1; j < rows.length; j++) {
    const r = rows[j]
    if (r.session.status === 'finished' && conditionKey(r.session) === key && r.averages.has(swimmerId)) {
      return r.averages.get(swimmerId)!
    }
  }
  return null
}
