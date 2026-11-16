import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts'
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent'
import { timeDomain, timeTicks } from '../domain/chart'
import { compareChronological, metricsOf, type SessionDetail } from '../domain/compare'
import { formatDate } from '../domain/date'
import type { Centis } from '../domain/types'
import { COLORS, SERIES_COLORS } from './chartTheme'
import { formatMetric, type MetricOption } from './metricOptions'

export interface TrendSeries {
  id: number
  name: string
  /** 色番号（SERIES_COLORS の位置） */
  slot: number
}

interface Props {
  /** 並べる測定（並び順は問わない。日付順に並べ直す） */
  details: SessionDetail[]
  series: TrendSeries[]
  /** 比べる値（平均・ベスト・ばらつきなど） */
  metric: MetricOption
}

type Row = { index: number; date: string } & Record<string, number | string | null>

const key = (id: number) => `s${id}`
const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`

/** 測定ごとの値（平均・ベスト・ばらつきなど）の推移 */
export function TrendChart({ details, series, metric }: Props) {
  const formatTime = (v: Centis | null | undefined) => formatMetric(metric, v)
  const sessions = [...details].sort((a, b) => compareChronological(a.session, b.session))
  const averages = sessions.map((d) => {
    const m = new Map<number, Centis | null>()
    for (const s of series) {
      const times = d.times.get(s.id)
      m.set(s.id, times ? metricsOf(times)[metric.key] : null)
    }
    return m
  })
  const data: Row[] = sessions.map((d, i) => {
    const row: Row = { index: i, date: d.session.date }
    for (const s of series) row[key(s.id)] = averages[i].get(s.id) ?? null
    return row
  })
  // 落ち幅はマイナス（後半の方が速い）もあるので、0 より下も表示する
  const domain = timeDomain(averages.flatMap((m) => [...m.values()]), 50, !!metric.signed)
  // 本数の違う測定が混ざっているときは、日付に本数も添える
  const mixedReps = new Set(sessions.map((d) => d.session.reps)).size > 1
  const hasInProgress = sessions.some((d) => d.session.status === 'in_progress')
  const tickLabel = (d: SessionDetail) =>
    mixedReps ? `${shortDate(d.session.date)}（${d.session.reps}本）` : shortDate(d.session.date)

  if (!domain) {
    return (
      <p className="empty">
        選んだ選手の「{metric.label}」を出せる記録がまだありません。
        {metric.key === 'stdDev' && '（ばらつきは、2本以上のタイムがある測定で計算します）'}
      </p>
    )
  }

  const endLabels = series.length <= 4
  return (
    <>
      <ul className="chart-legend" aria-label="凡例">
        {series.map((s) => (
          <li key={s.id}>
            <span className="legend-line" style={{ background: SERIES_COLORS[s.slot] }} />
            {s.name}
          </li>
        ))}
      </ul>
      <div className="chart-wrap" role="img" aria-label={`測定ごとの${metric.label}の折れ線グラフ`}>
        <ResponsiveContainer width="100%" height={380}>
          <LineChart data={data} margin={{ top: 16, right: endLabels ? 88 : 32, bottom: 20, left: 8 }}>
            <CartesianGrid stroke={COLORS.grid} vertical={false} />
            <XAxis
              dataKey="index"
              type="number"
              domain={[0, Math.max(sessions.length - 1, 1)]}
              ticks={sessions.map((_, i) => i)}
              tickFormatter={(i: number) => (sessions[i] ? tickLabel(sessions[i]) : '')}
              // 測定が多いときは、重なる日付を間引く
              interval="preserveStartEnd"
              minTickGap={12}
              stroke={COLORS.axis}
              tick={{ fill: COLORS.muted, fontSize: 12 }}
              tickLine={false}
              padding={{ left: 24, right: 24 }}
              label={{ value: '測定日', position: 'insideBottom', offset: -12, fill: COLORS.muted, fontSize: 12 }}
            />
            <YAxis
              domain={domain}
              ticks={timeTicks(domain)}
              tickFormatter={(v: number) => formatTime(v)}
              stroke={COLORS.axis}
              tick={{ fill: COLORS.muted, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip
              content={(props: TooltipContentProps<ValueType, NameType>) => (
                <TrendTooltip {...props} series={series} sessions={sessions} averages={averages} metric={metric} />
              )}
              cursor={{ stroke: COLORS.axis }}
              isAnimationActive={false}
            />
            {series.map((s) => {
              const color = SERIES_COLORS[s.slot]
              const lastIndex = averages.reduce<number>((last, m, i) => (m.get(s.id) != null ? i : last), -1)
              return (
                <Line
                  key={s.id}
                  dataKey={key(s.id)}
                  name={s.name}
                  stroke={color}
                  strokeWidth={2}
                  // 参加しなかった日は飛ばして、参加した日どうしを結ぶ
                  connectNulls
                  isAnimationActive={false}
                  dot={{ r: 4, fill: color, stroke: COLORS.surface, strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: color, stroke: COLORS.surface, strokeWidth: 2 }}
                  label={
                    endLabels
                      ? (p: { x?: number | string; y?: number | string; index?: number }) =>
                          p.index === lastIndex ? (
                            <text key={p.index} x={Number(p.x) + 8} y={Number(p.y) + 4} fontSize={12} fill={COLORS.secondary}>
                              {s.name}
                            </text>
                          ) : (
                            <g key={p.index} />
                          )
                      : undefined
                  }
                />
              )
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="hint chart-note">
        上に行くほど{metric.upMeans}を表します。各点はその測定の「{metric.label}」で、参加しなかった測定は飛ばして結んでいます。
        {metric.title && `（${metric.label}：${metric.title}）`}
        {mixedReps && '本数の違う測定が混ざっています（本数が多いほどタイムは遅くなりやすい点に注意）。'}
        {hasInProgress && '入力中の測定は、入力済みの本だけで計算しています。'}
        {sessions.length === 1 && '測定が1件だけなので、まだ線にはなりません。'}
      </p>

      <div className="table-scroll">
        <table className="compare-summary">
          <thead>
            <tr>
              <th>選手</th>
              {sessions.map((d) => (
                <th key={d.session.id} title={formatDate(d.session.date)}>
                  {tickLabel(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {series.map((s) => (
              <tr key={s.id}>
                <th>
                  <span className="legend-line" style={{ background: SERIES_COLORS[s.slot] }} />
                  {s.name}
                </th>
                {averages.map((m, i) => (
                  <td key={i} className="num">
                    {m.get(s.id) != null ? formatTime(m.get(s.id)) : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function TrendTooltip({
  active,
  label,
  series,
  sessions,
  averages,
  metric,
}: TooltipContentProps<ValueType, NameType> & {
  series: TrendSeries[]
  sessions: SessionDetail[]
  averages: Map<number, Centis | null>[]
  metric: MetricOption
}) {
  const i = Number(label)
  if (!active || !sessions[i]) return null
  const joined = (id: number) => !!sessions[i].times.get(id)?.some((t) => t != null)
  return (
    <div className="chart-tooltip">
      <div className="tt-rep">
        {formatDate(sessions[i].session.date)}　{sessions[i].session.distance}m × {sessions[i].session.reps}本
        {sessions[i].session.status === 'in_progress' && '（入力中）'}
      </div>
      <div className="tt-rep">{metric.label}</div>
      <table className="tt-table">
        <tbody>
          {series.map((s) => (
            <tr key={s.id}>
              <td>
                <span className="legend-dot" style={{ background: SERIES_COLORS[s.slot] }} />
                {s.name}
              </td>
              <td className="num">
                {averages[i].get(s.id) != null
                  ? formatMetric(metric, averages[i].get(s.id))
                  : joined(s.id)
                    ? '—'
                    : '不参加'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
