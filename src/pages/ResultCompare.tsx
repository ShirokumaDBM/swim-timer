import { lazy, Suspense, useState, type ReactNode } from 'react'
import {
  compareWithScope,
  metricsOf,
  type CompareScope,
  type MetricKey,
  type ScopeComparison,
  type SessionDetail,
} from '../domain/compare'
import { formatDate } from '../domain/date'
import { toRepTimes, type Grid } from '../domain/grid'
import { sessionMenu } from '../domain/sessionLabel'
import { formatDiff, formatTime } from '../domain/time'
import type { Centis, Id, Session } from '../domain/types'
import { METRIC_OPTIONS } from './metricOptions'

// グラフのライブラリは大きいので、比較のグラフを表示するときに読み込む
const CompareChart = lazy(() => import('./CompareChart').then((m) => ({ default: m.CompareChart })))

interface Props {
  session: Session
  /** 表示順の選手ID・名前・タイム（結果表と同じ並び） */
  swimmerIds: Id[]
  names: string[]
  grid: Grid
  /** 選手名のセル（レーン番号つき） */
  nameCell: (row: number) => ReactNode
  /** 今回より前の、同じ条件の終了した測定（新しい順） */
  comparable: SessionDetail[]
}

const SCOPE_SHORT: Record<CompareScope, string> = { previous: '前回', month: '同じ月', all: '全期間' }

/** 表に出す指標（グラフ画面の「日ごとの推移」と同じ一覧） */
const COLUMNS = METRIC_OPTIONS

export function ResultCompare({ session, swimmerIds, names, grid, nameCell, comparable }: Props) {
  const [scope, setScope] = useState<CompareScope>('previous')
  const [chartSwimmer, setChartSwimmer] = useState<Id | null>(null)

  // 比較の条件は距離・本数（種目は問わない）
  const condition = sessionMenu({ distance: session.distance, reps: session.reps })
  if (comparable.length === 0) {
    return (
      <section className="card compare-card">
        <h4>過去との比較</h4>
        <p className="hint">
          同じ条件（{condition}）の終了した過去の測定がまだないため、比較は次回から表示されます。
        </p>
      </section>
    )
  }

  const month = session.date.slice(0, 7)
  const monthCount = comparable.filter((d) => d.session.date.slice(0, 7) === month).length
  const scopes: { value: CompareScope; label: string; count: number }[] = [
    { value: 'previous', label: '前回', count: 1 },
    { value: 'month', label: `同じ月（${monthCount}回）`, count: monthCount },
    { value: 'all', label: `これまで全部（${comparable.length}回）`, count: comparable.length },
  ]

  const times = grid.map((row) => toRepTimes(row))
  const results = swimmerIds.map((id, r) => compareWithScope(id, times[r], session.date, comparable, scope))
  // 平均の自己ベスト更新：これまでのどの回の平均よりも速い
  const isBestAverage = swimmerIds.map((id, r) => {
    const cur = results[r].current.average
    const past = comparable
      .map((d) => d.times.get(id))
      .map((t) => (t ? metricsOf(t).average : null))
      .filter((v): v is Centis => v != null)
    return cur != null && past.length > 0 && cur < Math.min(...past)
  })

  const selected = chartSwimmer != null && swimmerIds.includes(chartSwimmer) ? chartSwimmer : swimmerIds[0]
  const sel = swimmerIds.indexOf(selected)
  const selResult = results[sel]

  const scopeText =
    scope === 'previous'
      ? '各選手が参加した直近の測定と比べています。'
      : scope === 'month'
        ? `${Number(month.slice(0, 4))}年${Number(month.slice(5))}月のこれまでの測定の平均と比べています。`
        : 'これまでのすべての測定の平均と比べています。'

  return (
    <section className="card compare-card">
      <h4>過去との比較</h4>
      <div className="order-switch scope-switch" role="radiogroup" aria-label="比べる相手">
        <span className="hint">比べる相手：</span>
        {scopes.map((s) => (
          <button
            key={s.value}
            role="radio"
            aria-checked={scope === s.value}
            disabled={s.count === 0}
            className={scope === s.value ? 'preset selected' : 'preset'}
            onClick={() => setScope(s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="hint">
        同じ条件（{condition}）の測定のうち、{scopeText}
        下段が今回との差で、マイナス（青 ▲）は良くなったこと、プラス（赤 ▼）は悪くなったことを表します。
      </p>

      <div className="table-scroll">
        <table className="compare-table metrics-table">
          <thead>
            <tr>
              <th>選手</th>
              {COLUMNS.map((c) => (
                <th key={c.key} className="right" title={c.title}>
                  {c.label}
                </th>
              ))}
              <th>比べた測定</th>
            </tr>
          </thead>
          <tbody>
            {swimmerIds.map((id, r) => (
              <tr key={id}>
                {nameCell(r)}
                {COLUMNS.map((c) => (
                  <MetricCell
                    key={c.key}
                    result={results[r]}
                    metric={c.key}
                    signed={c.signed}
                    badge={c.key === 'average' && isBestAverage[r] ? '平均ベスト更新' : undefined}
                  />
                ))}
                <td className="hint nowrap">{referenceLabel(results[r], scope)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 className="sub">1本ごとの推移を比べる</h4>
      <div className="swimmer-picker" role="radiogroup" aria-label="推移を比べる選手">
        {swimmerIds.map((id, r) => (
          <button
            key={id}
            role="radio"
            aria-checked={id === selected}
            className={id === selected ? 'preset selected' : 'preset'}
            onClick={() => setChartSwimmer(id)}
          >
            {names[r]}
          </button>
        ))}
      </div>
      <p className="hint">
        {names[sel]}：今回
        {selResult.series
          ? ` と ${SCOPE_SHORT[scope]}（${referenceLabel(selResult, scope)}${selResult.sessions.length > 1 ? '。何本目ごとの平均' : ''}）`
          : '（この条件では比べる過去の測定がありません）'}
      </p>
      <Suspense fallback={<p className="hint">グラフを読み込み中…</p>}>
        <CompareChart
          reps={session.reps}
          showSummary={false}
          series={[
            { id: 'current', name: '今回', slot: 0, row: grid[sel] },
            ...(selResult.series
              ? [{ id: 'reference', name: SCOPE_SHORT[scope], slot: 1, row: selResult.series, emptyLabel: '—' }]
              : []),
          ]}
        />
      </Suspense>
    </section>
  )
}

/** 比べた測定の説明（前回なら日付、複数回なら回数） */
function referenceLabel(result: ScopeComparison, scope: CompareScope): string {
  const n = result.sessions.length
  if (n === 0) return 'なし（初めて）'
  if (scope === 'previous' || n === 1) return formatDate(result.sessions[0].date).slice(5)
  return `${n}回の平均`
}

interface CellProps {
  result: ScopeComparison
  metric: MetricKey
  /** 値そのものに符号を付けて表示する（落ち幅） */
  signed?: boolean
  badge?: string
}

/** 上段：今回の値、下段：比較相手との差（色と矢印）と相手の値 */
function MetricCell({ result, metric, signed, badge }: CellProps) {
  const show = (v: Centis | null) => (v == null ? '—' : signed ? formatDiff(v) : formatTime(v))
  const cur = result.current[metric]
  const diff = result.diff?.[metric] ?? null
  const cls = diff == null ? '' : diff < 0 ? 'faster' : diff > 0 ? 'slower' : 'same'
  return (
    <td className="metric">
      <div className="m-cur num">
        {badge && <span className="new-best">{badge}</span>}
        {show(cur)}
      </div>
      {diff != null && (
        <div className={`m-diff cmp ${cls}`}>
          <span className="num">{formatDiff(diff)}</span>
          <span className="cmp-label" aria-label={diff < 0 ? '改善' : diff > 0 ? '悪化' : '変化なし'}>
            {diff < 0 ? ' ▲' : diff > 0 ? ' ▼' : ''}
          </span>
          <span className="m-ref num">（{show(result.reference![metric])}）</span>
        </div>
      )}
    </td>
  )
}
