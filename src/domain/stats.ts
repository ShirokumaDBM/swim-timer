import type { Centis, RepTimes } from './types'

const recorded = (times: RepTimes): Centis[] =>
  times.filter((t): t is Centis => t != null)

/** 平均タイム（入力済みの本だけで計算。1本もなければ null） */
export function average(times: RepTimes): Centis | null {
  const xs = recorded(times)
  if (xs.length === 0) return null
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

/**
 * 各本の「前の本との差」。index 0 が1本目（常に null）。
 * 自分か直前の本が未入力・欠損なら null。
 * 例: 3本目 37.33、4本目 38.52 → 4本目の差は +119（+1.19秒）
 */
export function diffsFromPrevious(times: RepTimes): (Centis | null)[] {
  return times.map((t, i) => {
    if (i === 0) return null
    const prev = times[i - 1]
    if (t == null || prev == null) return null
    return t - prev
  })
}

/** ばらつき（母標準偏差）。2本未満なら null */
export function standardDeviation(times: RepTimes): Centis | null {
  const xs = recorded(times)
  if (xs.length < 2) return null
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  const variance = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length
  return Math.sqrt(variance)
}

export interface SwimmerStats {
  average: Centis | null
  best: Centis | null
  worst: Centis | null
  stdDev: Centis | null
  /** 入力済み本数 */
  count: number
  diffs: (Centis | null)[]
}

export function swimmerStats(times: RepTimes): SwimmerStats {
  const xs = recorded(times)
  return {
    average: average(times),
    best: xs.length ? Math.min(...xs) : null,
    worst: xs.length ? Math.max(...xs) : null,
    stdDev: standardDeviation(times),
    count: xs.length,
    diffs: diffsFromPrevious(times),
  }
}

/**
 * 全体の進み具合: 1本目から数えて、全員分が埋まっている本数（＝何本目まで終わったか）。
 * filled[選手][本] = そのマスが入力済み（欠損として確定した場合も true）。
 */
export function completedReps(filled: boolean[][], reps: number): number {
  for (let r = 0; r < reps; r++) {
    if (filled.some((row) => !row[r])) return r
  }
  return reps
}
