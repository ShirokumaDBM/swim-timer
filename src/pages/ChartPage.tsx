import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent'
import { db } from '../db'
import { MAX_COMPARE, repSeries, timeDomain, timeTicks, toggleSlot, type RepPoint, type SlotEntry } from '../domain/chart'
import { buildGrid, toRepTimes } from '../domain/grid'
import { laneRowOrder } from '../domain/lanes'
import { sessionTitle } from '../domain/sessionLabel'
import { swimmerStats } from '../domain/stats'
import { formatDiff, formatTime } from '../domain/time'
import { listSessions } from '../repo/sessions'
import { listTimes } from '../repo/times'
import { COLORS, repTicks, SERIES_COLORS } from './chartTheme'
import { CompareChart } from './CompareChart'
import { loadLaneOrder } from './settings'
import './ChartPage.css'


interface Props {
  /** 最初に開く測定（未指定なら一番新しい測定） */
  initialSessionId?: number
  /** 最初に選ぶ選手（未指定なら先頭の選手） */
  initialSwimmerId?: number
}

type Point = RepPoint & { missing: boolean }

export function ChartPage({ initialSessionId, initialSwimmerId }: Props) {
  const [sessionId, setSessionId] = useState(initialSessionId)
  const [swimmerId, setSwimmerId] = useState(initialSwimmerId)
  /** 1人を詳しく見る／重ねて比べる */
  const [mode, setMode] = useState<'single' | 'compare'>('single')
  /** 重ねて比べる選手と色（null = まだ選んでいない → 先頭から8人） */
  const [entries, setEntries] = useState<SlotEntry[] | null>(null)

  const data = useLiveQuery(async () => {
    const sessions = await listSessions()
    const session = sessions.find((s) => s.id === sessionId) ?? sessions[0]
    if (!session) return { sessions }
    const [swimmers, records] = await Promise.all([db.swimmers.bulkGet(session.swimmerIds), listTimes(session.id!)])
    return { sessions, session, swimmers, records }
  }, [sessionId])

  if (!data) return <p>読み込み中…</p>
  const { sessions, session } = data
  if (!session) {
    return (
      <div className="page">
        <p className="empty">測定がまだありません。</p>
      </div>
    )
  }

  // 選手の並びは測定入力画面と同じ（レーン順の設定に合わせる）
  const rowOrder = laneRowOrder(session.lanes, session.swimmerIds.length, loadLaneOrder())
  const ids = rowOrder.map((i) => session.swimmerIds[i])
  const nameOf = (id: number) =>
    data.swimmers![session.swimmerIds.indexOf(id)]?.name ?? '（削除された選手）'
  const laneOf = (id: number) => session.lanes?.[session.swimmerIds.indexOf(id)] ?? null

  const selected = swimmerId != null && ids.includes(swimmerId) ? swimmerId : ids[0]
  const row = buildGrid([selected], session.reps, data.records!)[0]
  const times = toRepTimes(row)
  const stats = swimmerStats(times)
  const points: Point[] = repSeries(times).map((p, i) => ({ ...p, missing: row[i] === null }))

  // 重ねて比べる選手（この測定に参加している選手だけ）
  const compareEntries = (entries ?? ids.slice(0, MAX_COMPARE).reduce<SlotEntry[]>((l, id) => toggleSlot(l, id), []))
    .filter((e) => ids.includes(e.id))
  const slotOf = (id: number) => compareEntries.find((e) => e.id === id)?.slot
  const compareRows = buildGrid(ids, session.reps, data.records!)
  const compareSeries = ids
    .filter((id) => slotOf(id) != null)
    .map((id) => ({ id, name: nameOf(id), slot: slotOf(id)!, row: compareRows[ids.indexOf(id)] }))
  const full = compareEntries.length >= MAX_COMPARE

  function changeSession(id: number) {
    setSessionId(id)
    // 選手が変わるので、重ねる選手は選び直し（先頭から8人）
    setEntries(null)
  }

  return (
    <div className="page chart-page">
      <div className="chart-controls">
        <div className="control-row">
          <label>
            測定
            <select value={session.id} onChange={(e) => changeSession(Number(e.target.value))}>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {sessionTitle(s)}（{s.swimmerIds.length}人）{s.status === 'in_progress' ? '・入力中' : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="order-switch" role="radiogroup" aria-label="表示">
            <button
              role="radio"
              aria-checked={mode === 'single'}
              className={mode === 'single' ? 'preset selected' : 'preset'}
              onClick={() => setMode('single')}
            >
              1人を詳しく
            </button>
            <button
              role="radio"
              aria-checked={mode === 'compare'}
              className={mode === 'compare' ? 'preset selected' : 'preset'}
              onClick={() => setMode('compare')}
            >
              重ねて比べる
            </button>
          </div>
        </div>
        {mode === 'single' ? (
          <div className="swimmer-picker" role="radiogroup" aria-label="選手">
            {ids.map((id) => (
              <button
                key={id}
                role="radio"
                aria-checked={id === selected}
                className={id === selected ? 'preset selected' : 'preset'}
                onClick={() => setSwimmerId(id)}
              >
                {laneOf(id) != null && <span className="lane-mini">{laneOf(id)}</span>}
                {nameOf(id)}
              </button>
            ))}
          </div>
        ) : (
          <div className="swimmer-picker" role="group" aria-label="重ねる選手">
            {ids.map((id) => {
              const slot = slotOf(id)
              const on = slot != null
              return (
                <button
                  key={id}
                  role="checkbox"
                  aria-checked={on}
                  disabled={!on && full}
                  className={on ? 'preset selected' : 'preset'}
                  onClick={() => setEntries(toggleSlot(compareEntries, id))}
                >
                  <span
                    className="legend-dot"
                    style={on ? { background: SERIES_COLORS[slot] } : undefined}
                    aria-hidden="true"
                  />
                  {nameOf(id)}
                </button>
              )
            })}
            {full && ids.length > MAX_COMPARE && (
              <span className="hint">重ねられるのは{MAX_COMPARE}人までです。ほかの選手を外すと選べます。</span>
            )}
          </div>
        )}
      </div>

      {mode === 'compare' ? (
        <section className="card chart-card">
          <h3>
            重ねて比べる <span className="hint">選んだ選手の1本ごとのタイム</span>
          </h3>
          {compareSeries.length === 0 ? (
            <p className="empty">比べる選手を選んでください。</p>
          ) : (
            <CompareChart series={compareSeries} reps={session.reps} />
          )}
        </section>
      ) : (
      <section className="card chart-card">
        <h3>
          {nameOf(selected)} <span className="hint">1本ごとのタイムの推移</span>
        </h3>

        <div className="stat-tiles">
          <Tile label="平均" value={formatTime(stats.average)} strong />
          <Tile label="ベスト" value={formatTime(stats.best)} />
          <Tile label="ワースト" value={formatTime(stats.worst)} />
          <Tile label="ばらつき" value={stats.stdDev == null ? '' : (stats.stdDev / 100).toFixed(2)} />
          <Tile label="本数" value={`${stats.count} / ${session.reps}`} />
        </div>

        {stats.count === 0 ? (
          <p className="empty">この選手のタイムはまだ入力されていません。</p>
        ) : (
          <>
            <TimeChart points={points} reps={session.reps} average={stats.average} best={stats.best} worst={stats.worst} />
            <p className="hint chart-note">
              上に行くほど遅いタイムです。点線は平均、線が途切れている本は休んだ本・未入力の本です。
            </p>
          </>
        )}

        <details className="data-table">
          <summary>数値で見る</summary>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>本数</th>
                  {points.map((p) => (
                    <th key={p.rep}>{p.rep}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>タイム</th>
                  {points.map((p) => (
                    <td key={p.rep} className="num">
                      {p.missing ? '—' : formatTime(p.time)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th>前の本との差</th>
                  {points.map((p) => (
                    <td key={p.rep} className="num">
                      {formatDiff(p.diff)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </section>
      )}
    </div>
  )
}

function Tile({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? 'tile strong' : 'tile'}>
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value || '—'}</span>
    </div>
  )
}

interface ChartProps {
  points: Point[]
  reps: number
  average: number | null
  best: number | null
  worst: number | null
}

function TimeChart({ points, reps, average, best, worst }: ChartProps) {
  const domain = timeDomain(points.map((p) => p.time))!
  // ベストとワーストだけ数字を添える（同じタイムが複数あれば最初の本）
  const bestRep = points.find((p) => p.time === best)?.rep
  const worstRep = best !== worst ? points.find((p) => p.time === worst)?.rep : undefined

  return (
    <div className="chart-wrap" role="img" aria-label="1本ごとのタイムの折れ線グラフ">
      <ResponsiveContainer width="100%" height={360}>
        <LineChart data={points} margin={{ top: 24, right: 88, bottom: 20, left: 8 }}>
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
          <Tooltip content={RepTooltip} cursor={{ stroke: COLORS.axis }} isAnimationActive={false} />
          {average != null && (
            <ReferenceLine
              y={average}
              stroke={COLORS.secondary}
              strokeDasharray="4 4"
              label={{
                value: `平均 ${formatTime(average)}`,
                position: 'right',
                fill: COLORS.secondary,
                fontSize: 12,
              }}
            />
          )}
          <Line
            dataKey="time"
            stroke={COLORS.series}
            strokeWidth={2}
            connectNulls={false}
            isAnimationActive={false}
            activeDot={{ r: 6, fill: COLORS.series, stroke: COLORS.surface, strokeWidth: 2 }}
            dot={(props: { cx?: number; cy?: number; payload?: Point; index?: number }) => {
              const { cx, cy, payload, index } = props
              if (cx == null || cy == null || payload?.time == null) return <g key={index} />
              const tag = payload.rep === bestRep ? 'ベスト' : payload.rep === worstRep ? 'ワースト' : null
              return (
                <g key={index}>
                  <circle cx={cx} cy={cy} r={4} fill={COLORS.series} stroke={COLORS.surface} strokeWidth={2} />
                  {tag && (
                    <text
                      x={payload.rep === 1 ? cx - 4 : payload.rep === reps ? cx + 4 : cx}
                      y={tag === 'ベスト' ? cy + 20 : cy - 12}
                      // 端の本は内側に寄せて、軸の目盛りや枠と重ならないようにする
                      textAnchor={payload.rep === 1 ? 'start' : payload.rep === reps ? 'end' : 'middle'}
                      fontSize={12}
                      fill={COLORS.secondary}
                    >
                      {tag} {formatTime(payload.time)}
                    </text>
                  )}
                </g>
              )
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function RepTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload as Point
  return (
    <div className="chart-tooltip">
      <div className="tt-rep">{p.rep}本目</div>
      <div className="tt-time num">{p.missing ? '休み' : p.time == null ? '未入力' : formatTime(p.time)}</div>
      {p.diff != null && <div className="tt-diff num">前の本との差 {formatDiff(p.diff)}</div>}
    </div>
  )
}
