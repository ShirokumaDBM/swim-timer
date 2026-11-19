import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { MAX_COMPARE, toggleSlot, type SlotEntry } from '../domain/chart'
import { compareChronological, type MetricKey } from '../domain/compare'
import { formatDate } from '../domain/date'
import type { Id } from '../domain/types'
import { loadAllDetails } from '../repo/results'
import { listSwimmers } from '../repo/swimmers'
import { SERIES_COLORS } from './chartTheme'
import { METRIC_OPTIONS } from './metricOptions'
import { TrendChart } from './TrendChart'

interface Props {
  /** 最初に選ぶ距離（グラフ画面で選んでいた測定の距離） */
  initialDistance: number
}

/** 日ごとの推移：比べる測定と選手を自由に選んで、平均タイムの変化を見る */
export function TrendView({ initialDistance }: Props) {
  const data = useLiveQuery(async () => {
    const [details, swimmers] = await Promise.all([loadAllDetails(), listSwimmers()])
    return { details, swimmers }
  })
  const [distanceChoice, setDistanceChoice] = useState(initialDistance)
  /** 外した測定（何も外していなければ全部が対象。新しい測定は自動で入る） */
  const [excluded, setExcluded] = useState<ReadonlySet<Id>>(new Set())
  /** 表示する選手と色（null = まだ選んでいない → 先頭から8人） */
  const [entries, setEntries] = useState<SlotEntry[] | null>(null)
  /** 比べる値（平均・ベスト・ばらつきなど） */
  const [metricKey, setMetricKey] = useState<MetricKey>('average')
  const metric = METRIC_OPTIONS.find((m) => m.key === metricKey)!

  if (!data) return <p>読み込み中…</p>

  // 距離の違う測定は平均タイムを比べられないので、距離ごとに見る
  const distances = [...new Set(data.details.map((d) => d.session.distance))].sort((a, b) => a - b)
  const distance = distances.includes(distanceChoice) ? distanceChoice : distances[0]
  // 新しい順
  const candidates = data.details
    .filter((d) => d.session.distance === distance)
    .sort((a, b) => compareChronological(b.session, a.session))
  const included = candidates.filter((d) => !excluded.has(d.session.id))
  const repsList = [...new Set(candidates.map((d) => d.session.reps))].sort((a, b) => a - b)

  // 選んだ測定のどれかにタイムがある選手（選手一覧の順。削除された選手は最後）
  const withTimes = new Set<Id>()
  for (const d of included) {
    for (const [id, times] of d.times) if (times.some((t) => t != null)) withTimes.add(id)
  }
  const known = data.swimmers.filter((s) => withTimes.has(s.id))
  const knownIds = new Set(known.map((s) => s.id))
  const swimmers = [
    ...known.map((s) => ({ id: s.id, name: s.name })),
    ...[...withTimes].filter((id) => !knownIds.has(id)).map((id) => ({ id, name: '（削除された選手）' })),
  ]
  const ids = swimmers.map((s) => s.id)
  const active = (entries ?? ids.slice(0, MAX_COMPARE).reduce<SlotEntry[]>((l, id) => toggleSlot(l, id), [])).filter(
    (e) => ids.includes(e.id),
  )
  const slotOf = (id: Id) => active.find((e) => e.id === id)?.slot
  const series = swimmers.filter((s) => slotOf(s.id) != null).map((s) => ({ ...s, slot: slotOf(s.id)! }))
  const full = active.length >= MAX_COMPARE

  function toggleSession(id: Id) {
    const next = new Set(excluded)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExcluded(next)
  }

  /** f に合う測定だけを選ぶ */
  function selectOnly(f: (reps: number) => boolean) {
    setExcluded(new Set(candidates.filter((d) => !f(d.session.reps)).map((d) => d.session.id)))
  }

  return (
    <>
      <fieldset className="trend-sessions">
        <legend>
          比べる測定（{included.length} / {candidates.length}件）
          <button type="button" onClick={() => selectOnly(() => true)}>
            すべて選ぶ
          </button>
          <button type="button" onClick={() => selectOnly(() => false)}>
            すべて外す
          </button>
          {repsList.length > 1 &&
            repsList.map((reps) => (
              <button type="button" key={reps} onClick={() => selectOnly((r) => r === reps)}>
                {reps}本だけ
              </button>
            ))}
        </legend>
        {distances.length > 1 && (
          <div className="order-switch trend-distance" role="radiogroup" aria-label="距離">
            <span className="hint">距離：</span>
            {distances.map((d) => (
              <button
                key={d}
                role="radio"
                aria-checked={d === distance}
                className={d === distance ? 'preset selected' : 'preset'}
                onClick={() => {
                  setDistanceChoice(d)
                  setExcluded(new Set())
                }}
              >
                {d}m
              </button>
            ))}
          </div>
        )}
        <div className="trend-session-list">
          {candidates.map((d) => {
            const on = !excluded.has(d.session.id)
            return (
              <label key={d.session.id} className={on ? 'checked' : ''}>
                <input type="checkbox" checked={on} onChange={() => toggleSession(d.session.id)} />
                {formatDate(d.session.date)}
                <span className="reps">{d.session.reps}本</span>
                {d.session.status === 'in_progress' && <span className="status-label">入力中</span>}
              </label>
            )
          })}
        </div>
      </fieldset>

      <div className="swimmer-picker" role="group" aria-label="表示する選手">
        {swimmers.map((s) => {
          const slot = slotOf(s.id)
          const on = slot != null
          return (
            <button
              key={s.id}
              role="checkbox"
              aria-checked={on}
              disabled={!on && full}
              className={on ? 'preset selected' : 'preset'}
              onClick={() => setEntries(toggleSlot(active, s.id))}
            >
              <span className="legend-dot" style={on ? { background: SERIES_COLORS[slot] } : undefined} aria-hidden="true" />
              {s.name}
            </button>
          )
        })}
        {full && swimmers.length > MAX_COMPARE && (
          <span className="hint">表示できるのは{MAX_COMPARE}人までです。ほかの選手を外すと選べます。</span>
        )}
      </div>

      <div className="order-switch metric-switch" role="radiogroup" aria-label="比べる値">
        <span className="hint">比べる値：</span>
        {METRIC_OPTIONS.map((m) => (
          <button
            key={m.key}
            role="radio"
            aria-checked={m.key === metricKey}
            title={m.title}
            className={m.key === metricKey ? 'preset selected' : 'preset'}
            onClick={() => setMetricKey(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <section className="card chart-card">
        <h3>
          日ごとの推移：{metric.label}{' '}
          <span className="hint">
            {distance}m・選んだ測定 {included.length}件
          </span>
        </h3>
        {included.length === 0 ? (
          <p className="empty">比べる測定を選んでください。</p>
        ) : series.length === 0 ? (
          <p className="empty">
            {swimmers.length === 0 ? '選んだ測定にはまだタイムが入力されていません。' : '表示する選手を選んでください。'}
          </p>
        ) : (
          <TrendChart details={included} series={series} metric={metric} />
        )}
      </section>
    </>
  )
}
