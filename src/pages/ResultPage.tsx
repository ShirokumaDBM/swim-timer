import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { findComparableSessions, type SessionDetail } from '../domain/compare'
import { resultCsv, resultCsvFileName } from '../domain/csv'
import { buildGrid, toRepTimes } from '../domain/grid'
import { hasLanes, laneRowOrder } from '../domain/lanes'
import { sessionTitle } from '../domain/sessionLabel'
import { swimmerStats } from '../domain/stats'
import { formatDiff, formatTime } from '../domain/time'
import type { Centis, Session, SessionStatus, TimeRecord } from '../domain/types'
import { listFinishedSessions, loadSessionDetails } from '../repo/results'
import { getSession } from '../repo/sessions'
import { listTimes } from '../repo/times'
import { ResultCompare } from './ResultCompare'
import { loadLaneOrder } from './settings'
import './InputPage.css'
import './ResultPage.css'

interface Props {
  /** 未指定なら一番新しい終了した測定 */
  sessionId?: number
  /** タイムを直す（入力画面で開く） */
  onEditTimes: (sessionId: number) => void
  onShowChart: (sessionId: number) => void
  onGoInput: () => void
}

export function ResultPage({ sessionId, onEditTimes, onShowChart, onGoInput }: Props) {
  const data = useLiveQuery(async () => {
    const session =
      (sessionId != null ? await getSession(sessionId) : undefined) ?? (await listFinishedSessions())[0]
    if (!session) return { session: undefined }
    const [swimmers, records, details] = await Promise.all([
      db.swimmers.bulkGet(session.swimmerIds),
      listTimes(session.id!),
      loadSessionDetails(session.distance, session.reps),
    ])
    const comparable = findComparableSessions(session, details)
    return { session, names: swimmers.map((s) => s?.name ?? '（削除された選手）'), records, comparable }
  }, [sessionId])

  if (!data) return <p>読み込み中…</p>
  if (!data.session) {
    return (
      <div className="page">
        <p className="empty">
          終了した測定がまだありません。測定入力画面の「測定終了」を押すと、ここに結果が表示されます。
          <button onClick={onGoInput}>測定入力へ</button>
        </p>
      </div>
    )
  }
  return (
    <Result
      session={data.session}
      allNames={data.names!}
      records={data.records!}
      comparable={data.comparable!}
      onEditTimes={() => onEditTimes(data.session!.id!)}
      onShowChart={() => onShowChart(data.session!.id!)}
    />
  )
}

interface ResultProps {
  session: Session
  allNames: string[]
  records: TimeRecord[]
  comparable: SessionDetail[]
  onEditTimes: () => void
  onShowChart: () => void
}

function Result({ session, allNames, records, comparable, onEditTimes, onShowChart }: ResultProps) {
  const cols = session.reps
  const withLanes = hasLanes(session.lanes)
  // 並びは測定入力画面と同じ設定に合わせる
  const rowOrder = laneRowOrder(session.lanes, session.swimmerIds.length, loadLaneOrder())
  const swimmerIds = rowOrder.map((i) => session.swimmerIds[i])
  const names = rowOrder.map((i) => allNames[i])
  const lanes = rowOrder.map((i) => session.lanes?.[i] ?? null)

  const grid = buildGrid(swimmerIds, cols, records)
  const stats = grid.map((row) => swimmerStats(toRepTimes(row)))
  const repNumbers = Array.from({ length: cols }, (_, i) => i + 1)

  function downloadCsv() {
    // 先頭に BOM を付けると、Excel で開いても文字化けしない
    const blob = new Blob(['﻿' + resultCsv(session, names, grid, lanes)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = resultCsvFileName(session)
    a.click()
    URL.revokeObjectURL(url)
  }

  const nameCell = (r: number) => (
    <th className="name-col">
      {withLanes && (
        <span className={lanes[r] == null ? 'lane-badge none' : 'lane-badge'} title="レーン">
          {lanes[r] ?? '－'}
        </span>
      )}
      {names[r]}
    </th>
  )

  return (
    <div className="page result-page">
      <div className="session-head">
        <h3>{sessionTitle(session)}</h3>
        <span className="hint">
          {session.swimmerIds.length}人
          {session.circle && `・サークル ${session.circle}`}
          {session.memo && `・${session.memo}`}
        </span>
        <StatusLabel status={session.status} />
        <span className="head-actions">
          <button onClick={onShowChart}>グラフを見る</button>
          <button onClick={downloadCsv}>CSVで保存</button>
          <button onClick={onEditTimes}>タイムを修正</button>
        </span>
      </div>

      <ResultCompare
        session={session}
        swimmerIds={swimmerIds}
        names={names}
        grid={grid}
        nameCell={nameCell}
        comparable={comparable}
      />

      <section className="card">
        <h4>結果表</h4>
        <div className="grid-scroll">
          <table className="time-grid result-grid">
            <thead>
              <tr>
                <th className="name-col">選手</th>
                <th className="avg-col">平均</th>
                {repNumbers.map((n) => (
                  <th key={n} className="num">
                    {n}
                  </th>
                ))}
                <th className="stat-col">ベスト</th>
                <th className="stat-col">ワースト</th>
                <th className="stat-col">ばらつき</th>
                <th className="stat-col">本数</th>
              </tr>
            </thead>
            <tbody>
              {grid.map((row, r) => {
                const s = stats[r]
                return (
                  <tr key={swimmerIds[r]}>
                    {nameCell(r)}
                    <td className="avg-col num">{formatTime(s.average)}</td>
                    {row.map((v, c) => (
                      <td
                        key={c}
                        className={[
                          'time-cell',
                          v === null ? 'missing' : '',
                          v != null && v === s.best ? 'best' : '',
                          v != null && v === s.worst && s.best !== s.worst ? 'worst' : '',
                        ].join(' ')}
                      >
                        <div className="value num">{v === undefined ? '' : v === null ? '—' : formatTime(v)}</div>
                        <div className={`diff num ${diffClass(s.diffs[c])}`}>{formatDiff(s.diffs[c])}</div>
                      </td>
                    ))}
                    <td className="stat-col num">{formatTime(s.best)}</td>
                    <td className="stat-col num">{formatTime(s.worst)}</td>
                    <td className="stat-col num">{s.stdDev == null ? '' : (s.stdDev / 100).toFixed(2)}</td>
                    <td className="stat-col num">
                      {s.count}/{cols}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="hint legend">
          <span className="swatch best" /> その選手のベスト <span className="swatch worst" /> ワースト　— は休んだ本        </p>
      </section>
    </div>
  )
}

function StatusLabel({ status }: { status: SessionStatus }) {
  return status === 'finished' ? null : <span className="status-label">入力中</span>
}

function diffClass(d: Centis | null): string {
  if (d == null) return ''
  const r = Math.round(d)
  return r > 0 ? 'slower' : r < 0 ? 'faster' : 'same'
}

