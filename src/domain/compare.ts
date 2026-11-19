import { average, swimmerStats } from './stats'
import type { Centis, Id, RepTimes, Session } from './types'

/** 比較に必要なセッション情報 + 各選手の平均タイム */
export interface SessionSummary {
  session: Pick<Session, 'id' | 'date' | 'distance' | 'reps' | 'status' | 'createdAt'>
  /** swimmerId → 平均タイム */
  averages: Map<Id, Centis>
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
export function findComparableSessions<T extends { session: SessionSummary['session'] }>(
  target: SessionSummary['session'],
  all: T[],
): T[] {
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
  sessionId: Id
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
  swimmerId: Id,
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

// ---------- 期間を選んだ比較（前回／同じ月／これまで全部） ----------

/** 比較の相手：前回／今回と同じ月／これまで全部 */
export type CompareScope = 'previous' | 'month' | 'all'

/** 1回の測定の、選手ごとの1本ずつのタイム */
export interface SessionDetail {
  session: SessionSummary['session']
  /** swimmerId → タイム列（index 0 が1本目。未入力・欠損は null） */
  times: Map<Id, RepTimes>
}

/** 比べる指標（すべて 1/100秒に丸めた値。計算できなければ null） */
export interface Metrics {
  average: Centis | null
  best: Centis | null
  worst: Centis | null
  /** ばらつき（標準偏差） */
  stdDev: Centis | null
  /** 前半（1〜N/2本目）の平均 */
  firstHalf: Centis | null
  /** 後半の平均 */
  secondHalf: Centis | null
  /** 落ち幅（後半 − 前半。プラス = 後半に遅くなった） */
  fade: Centis | null
}

export type MetricKey = keyof Metrics

const round = (v: number | null): Centis | null => (v == null ? null : Math.round(v))

/** 1人・1回分のタイム列から指標を出す */
export function metricsOf(times: RepTimes): Metrics {
  const s = swimmerStats(times)
  const half = Math.floor(times.length / 2)
  const firstHalf = round(average(times.slice(0, half)))
  const secondHalf = round(average(times.slice(half)))
  return {
    average: round(s.average),
    best: s.best,
    worst: s.worst,
    stdDev: round(s.stdDev),
    firstHalf,
    secondHalf,
    fade: firstHalf != null && secondHalf != null ? secondHalf - firstHalf : null,
  }
}

function mapMetrics(f: (key: MetricKey) => Centis | null): Metrics {
  return {
    average: f('average'),
    best: f('best'),
    worst: f('worst'),
    stdDev: f('stdDev'),
    firstHalf: f('firstHalf'),
    secondHalf: f('secondHalf'),
    fade: f('fade'),
  }
}

/** 複数回分の指標を、指標ごとに平均する（値のある回だけ。1/100秒に丸める） */
export function meanMetrics(list: Metrics[]): Metrics {
  return mapMetrics((key) => round(average(list.map((m) => m[key]))))
}

/** 複数回分のタイム列を、何本目ごとに平均する（その本の記録がある回だけ） */
export function meanSeries(list: RepTimes[], reps: number): RepTimes {
  return Array.from({ length: reps }, (_, i) => round(average(list.map((t) => t[i] ?? null))))
}

/**
 * 比較の相手にする測定を選ぶ。
 * comparable は findComparableSessions の結果（今回より前・同じ条件・終了済み、新しい順）。
 * その選手のタイムが1本もない測定は除く。
 */
export function scopeDetails(
  targetDate: string,
  comparable: SessionDetail[],
  scope: CompareScope,
  swimmerId: Id,
): SessionDetail[] {
  const joined = comparable.filter((d) => d.times.get(swimmerId)?.some((t) => t != null))
  if (scope === 'previous') return joined.slice(0, 1)
  if (scope === 'month') return joined.filter((d) => d.session.date.slice(0, 7) === targetDate.slice(0, 7))
  return joined
}

export interface ScopeComparison {
  current: Metrics
  /** 比較相手の指標（相手がなければ null）。複数回のときは各回の指標の平均 */
  reference: Metrics | null
  /** 今回 − 比較相手（マイナス = 今回の方が小さい＝速い・安定） */
  diff: Metrics | null
  /** 比較相手の1本ごとのタイム（複数回のときは何本目ごとの平均） */
  series: RepTimes | null
  /** 比較相手にした測定（新しい順） */
  sessions: { id: Id; date: string }[]
}

/** ある選手の今回のタイムを、選んだ期間の過去の測定と比べる */
export function compareWithScope(
  swimmerId: Id,
  currentTimes: RepTimes,
  targetDate: string,
  comparable: SessionDetail[],
  scope: CompareScope,
): ScopeComparison {
  const current = metricsOf(currentTimes)
  const picked = scopeDetails(targetDate, comparable, scope, swimmerId)
  if (picked.length === 0) return { current, reference: null, diff: null, series: null, sessions: [] }
  const lists = picked.map((d) => d.times.get(swimmerId)!)
  const reference = meanMetrics(lists.map(metricsOf))
  return {
    current,
    reference,
    diff: mapMetrics((key) =>
      current[key] != null && reference[key] != null ? current[key] - reference[key] : null,
    ),
    series: meanSeries(lists, currentTimes.length),
    sessions: picked.map((d) => ({ id: d.session.id, date: d.session.date })),
  }
}
