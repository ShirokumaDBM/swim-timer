import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts'
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent'
import { timeDomain, timeTicks } from '../domain/chart'
import type { CellValue } from '../domain/grid'
import { toRepTimes } from '../domain/grid'
import { swimmerStats } from '../domain/stats'
import { formatTime } from '../domain/time'
import { COLORS, repTicks, SERIES_COLORS } from './chartTheme'
// 凡例・ツールチップなどの見た目（結果画面からもこの部品を使うので、ここで読み込む）
import './ChartPage.css'

export interface CompareSeries {
  id: number
  name: string
  /** 色番号（SERIES_COLORS の位置） */
  slot: number
  row: CellValue[]
  /** 値がない本の表示（未指定なら「休み」「未入力」。平均の線など、休みとは言えないときに指定） */
  emptyLabel?: string
}

interface Props {
  series: CompareSeries[]
  reps: number
  /** 下に平均・ベストなどの表を出す（既定は出す） */
  showSummary?: boolean
}

/** 名前を線の端に直接書くのは4人まで（それ以上は重なるので凡例と表で示す） */
const MAX_END_LABELS = 4

type Row = { rep: number } & Record<string, number | null>

const key = (id: number) => `s${id}`

export function CompareChart({ series, reps, showSummary = true }: Props) {
  const data: Row[] = Array.from({ length: reps }, (_, i) => {
    const row: Row = { rep: i + 1 }
    for (const s of series) row[key(s.id)] = s.row[i] ?? null
    return row
  })
  const all = series.flatMap((s) => toRepTimes(s.row))
  const domain = timeDomain(all)
  const endLabels = series.length <= MAX_END_LABELS

  if (!domain) return <p className="empty">選んだ選手のタイムはまだ入力されていません。</p>

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
      <div className="chart-wrap" role="img" aria-label="選手ごとのタイムを重ねた折れ線グラフ">
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={data} margin={{ top: 16, right: endLabels ? 88 : 24, bottom: 20, left: 8 }}>
            <CartesianGrid stroke={COLORS.grid} vertical={false} />
            <XAxis
              dataKey="rep"
              type="number"
              domain={[1, reps]}
              ticks={repTicks(reps)}
              allowDecimals={false}
              stroke={COLORS.axis}
              tick={{ fill: COLORS.muted, fontSize: 12 }}
              tickLine={false}
              label={{ value: '本数', position: 'insideBottom', offset: -12, fill: COLORS.muted, fontSize: 12 }}
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
              content={(props: TooltipContentProps<ValueType, NameType>) => <CompareTooltip {...props} series={series} />}
              cursor={{ stroke: COLORS.axis }}
              isAnimationActive={false}
            />
            {series.map((s) => {
              const color = SERIES_COLORS[s.slot]
              const lastIndex = s.row.reduce<number>((last, v, i) => (v != null ? i : last), -1)
              return (
                <Line
                  key={s.id}
                  dataKey={key(s.id)}
                  name={s.name}
                  stroke={color}
                  strokeWidth={2}
                  connectNulls={false}
                  isAnimationActive={false}
                  // 重なった点が見分けられるよう、背景色の縁を付ける
                  dot={{ r: 4, fill: color, stroke: COLORS.surface, strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: color, stroke: COLORS.surface, strokeWidth: 2 }}
                  label={
                    endLabels
                      ? (p: { x?: number | string; y?: number | string; index?: number }) =>
                          p.index === lastIndex ? (
                            <text
                              key={p.index}
                              x={Number(p.x) + 8}
                              y={Number(p.y) + 4}
                              fontSize={12}
                              fill={COLORS.secondary}
                            >
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
      <p className="hint chart-note">上に行くほど遅いタイムです。線が途切れている本は休んだ本・未入力の本です。</p>

      {showSummary && (
      <div className="table-scroll">
        <table className="compare-summary">
          <thead>
            <tr>
              <th>選手</th>
              <th>平均</th>
              <th>ベスト</th>
              <th>ワースト</th>
              <th>ばらつき</th>
              <th>本数</th>
            </tr>
          </thead>
          <tbody>
            {series.map((s) => {
              const st = swimmerStats(toRepTimes(s.row))
              return (
                <tr key={s.id}>
                  <th>
                    <span className="legend-line" style={{ background: SERIES_COLORS[s.slot] }} />
                    {s.name}
                  </th>
                  <td className="num strong">{formatTime(st.average)}</td>
                  <td className="num">{formatTime(st.best)}</td>
                  <td className="num">{formatTime(st.worst)}</td>
                  <td className="num">{st.stdDev == null ? '' : (st.stdDev / 100).toFixed(2)}</td>
                  <td className="num">
                    {st.count}/{reps}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      )}
    </>
  )
}

function CompareTooltip({
  active,
  payload,
  label,
  series,
}: TooltipContentProps<ValueType, NameType> & { series: CompareSeries[] }) {
  if (!active || !payload?.length) return null
  const rep = Number(label)
  return (
    <div className="chart-tooltip">
      <div className="tt-rep">{rep}本目</div>
      <table className="tt-table">
        <tbody>
          {series.map((s) => {
            const v = s.row[rep - 1]
            return (
              <tr key={s.id}>
                <td>
                  <span className="legend-dot" style={{ background: SERIES_COLORS[s.slot] }} />
                  {s.name}
                </td>
                <td className="num">
                  {v != null ? formatTime(v) : (s.emptyLabel ?? (v === undefined ? '未入力' : '休み'))}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
