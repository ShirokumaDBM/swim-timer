import type { Centis, Session } from './types'

/** 比較に必要なセッション情報 + 各選手の平均タイム */
export interface SessionSummary {
  session: Pick<Session, 'id' | 'date' | 'distance' | 'reps' | 'status' | 'createdAt'>
  /** swimmerId → 平均タイム */
  averages: Map<number, Centis>
}

/** セッションの時系列順（日付 → 作成日時） */
export function compareChronological(
  a: Pick<Session, 'date' | 'createdAt'>,
  b: Pick<Session, 'date' | 'createdAt'>,
): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  return a.createdAt - b.createdAt
}

/**
 * target と比較できる過去のセッション（新しい順）。
 * 条件: 距離・本数が同じ / 測定終了済み / target より前 / target 自身ではない
 */
export function findComparableSessions(
  target: SessionSummary['session'],
  all: SessionSummary[],
): SessionSummary[] {
  return all
    .filter(
      ({ session: s }) =>
        s.id !== target.id &&
        s.status === 'finished' &&
        s.distance === target.distance &&
        s.reps === target.reps &&
        compareChronological(s, target) < 0,
    )
    .sort((a, b) => compareChronological(b.session, a.session))
}

export interface AverageReference {
  sessionId: number | undefined
  date: string
  average: Centis
  /** 今回 − 基準（マイナス = 速くなった） */
  diff: Centis
}

export interface AverageComparison {
  current: Centis
  /** 前回（その選手が参加した直近の同条件測定） */
  previous: AverageReference | null
  /** 過去の同条件測定で最も速い平均 */
  best: AverageReference | null
  /** 直近 recentCount 回の平均の平均 */
  recent: { count: number; average: Centis; diff: Centis } | null
}

/**
 * ある選手の今回の平均タイムを過去の同条件測定と比べる。
 * comparable は findComparableSessions の結果（新しい順）を渡す。
 */
export function compareSwimmerAverage(
  swimmerId: number,
  current: Centis,
  comparable: SessionSummary[],
  recentCount = 3,
): AverageComparison {
  const history = comparable
    .filter((c) => c.averages.has(swimmerId))
    .map((c) => ({
      sessionId: c.session.id,
      date: c.session.date,
      average: c.averages.get(swimmerId)!,
    }))

  if (history.length === 0) {
    return { current, previous: null, best: null, recent: null }
  }

  const prev = history[0]
  const best = history.reduce((a, b) => (b.average < a.average ? b : a))
  const recentList = history.slice(0, recentCount)
  // 表示（1/100秒）と差が食い違わないよう、1/100秒に丸めてから差を取る
  const recentAvg = Math.round(recentList.reduce((a, h) => a + h.average, 0) / recentList.length)

  return {
    current,
    previous: { ...prev, diff: current - prev.average },
    best: { ...best, diff: current - best.average },
    recent: { count: recentList.length, average: recentAvg, diff: current - recentAvg },
  }
}
