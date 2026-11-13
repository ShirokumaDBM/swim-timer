import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { db } from '../db'
import {
  buildGrid,
  cellValueOf,
  filledMatrix,
  firstEmptyCell,
  moveCell,
  parseCellInput,
  stepCell,
  toRepTimes,
  type Grid,
  type InputOrder,
} from '../domain/grid'
import { sessionTitle } from '../domain/sessionLabel'
import { completedReps, swimmerStats } from '../domain/stats'
import { formatTime } from '../domain/time'
import { hasLanes, laneRowOrder, type LaneOrder } from '../domain/lanes'
import type { Session, TimeRecord } from '../domain/types'
import { getSession, listInProgressSessions } from '../repo/sessions'
import { finishSession } from '../repo/results'
import { listTimes, saveCell } from '../repo/times'
import { SessionEditPanel } from './SessionEditPanel'
import { LANE_ORDER_LABELS, loadInputOrder, loadLaneOrder, saveInputOrder, saveLaneOrder } from './settings'
import { TimeCell, type NavKey } from './TimeCell'
import './InputPage.css'

interface Props {
  /** 未指定なら一番新しい「入力中」の測定を開く */
  sessionId?: number
  onGoNew: () => void
  /** 測定終了後・「結果を見る」で結果画面へ */
  onShowResult: (sessionId: number) => void
}

export function InputPage({ sessionId, onGoNew, onShowResult }: Props) {
  /** 設定を編集中の測定 */
  const [editingId, setEditingId] = useState<number | null>(null)
  const data = useLiveQuery(async () => {
    // 指定の測定が削除されていたら、一番新しい入力中の測定を開く
    const session =
      (sessionId != null ? await getSession(sessionId) : undefined) ??
      (await listInProgressSessions())[0]
    if (!session) return { session: undefined }
    const [swimmers, records] = await Promise.all([
      db.swimmers.bulkGet(session.swimmerIds),
      listTimes(session.id!),
    ])
    return { session, swimmers, records }
  }, [sessionId])

  if (!data) return <p>読み込み中…</p>
  if (!data.session) {
    return (
      <div className="page">
        <p className="empty">
          入力中の測定がありません。
          <button onClick={onGoNew}>新規測定へ</button>
        </p>
      </div>
    )
  }

  const names = data.swimmers!.map((s) => s?.name ?? '（削除された選手）')
  const editingThis = editingId === data.session.id
  return (
    <InputGrid
      key={data.session.id}
      session={data.session}
      allNames={names}
      records={data.records!}
      onShowResult={onShowResult}
      onEdit={editingThis ? undefined : () => setEditingId(data.session!.id!)}
      editPanel={
        editingThis && (
          <SessionEditPanel session={data.session} records={data.records!} onClose={() => setEditingId(null)} />
        )
      }
    />
  )
}

interface GridProps {
  session: Session
  /** session.swimmerIds と同じ並びの名前 */
  allNames: string[]
  records: TimeRecord[]
  /** 「測定情報を編集」（編集中は undefined） */
  onEdit?: () => void
  editPanel?: ReactNode
  onShowResult: (sessionId: number) => void
}

function InputGrid({ session, allNames, records, onEdit, editPanel, onShowResult }: GridProps) {
  const rows = session.swimmerIds.length
  const cols = session.reps
  const [order, setOrder] = useState<InputOrder>(loadInputOrder)
  const [laneOrder, setLaneOrder] = useState<LaneOrder>(loadLaneOrder)
  const [message, setMessage] = useState<string | null>(null)
  /** 未入力のマスがあるときの「測定終了」の確認中 */
  const [confirmFinish, setConfirmFinish] = useState(false)
  const finished = session.status === 'finished'

  // 表示する行の並び（レーン順に並べ替えたとき、行番号 r は並べ替え後の位置）
  const withLanes = hasLanes(session.lanes)
  const rowOrder = useMemo(
    () => laneRowOrder(session.lanes, rows, laneOrder),
    [session.lanes, rows, laneOrder],
  )
  const swimmerIds = useMemo(() => rowOrder.map((i) => session.swimmerIds[i]), [rowOrder, session.swimmerIds])
  const names = rowOrder.map((i) => allNames[i])
  const lanes = rowOrder.map((i) => session.lanes?.[i] ?? null)
  const grid: Grid = useMemo(() => buildGrid(swimmerIds, cols, records), [swimmerIds, cols, records])

  // コールバックから常に最新の値を参照する（マスの再描画を減らすため関数自体は作り直さない）
  const latest = useRef({ grid, order, session, swimmerIds })
  useLayoutEffect(() => {
    latest.current = { grid, order, session, swimmerIds }
  })

  const inputs = useRef(new Map<string, HTMLInputElement>())
  const registerInput = useCallback((row: number, col: number, el: HTMLInputElement | null) => {
    const key = `${row}-${col}`
    if (el) inputs.current.set(key, el)
    else inputs.current.delete(key)
  }, [])

  const focusCell = useCallback((row: number, col: number) => {
    const el = inputs.current.get(`${row}-${col}`)
    if (!el) return
    el.focus()
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [])

  // 開いたとき、入力順で最初の空きマスにカーソルを置く
  useEffect(() => {
    const pos = firstEmptyCell(latest.current.grid, latest.current.order)
    if (pos) focusCell(pos.row, pos.col)
  }, [focusCell])

  const onCommit = useCallback((row: number, col: number, text: string): boolean => {
    const input = parseCellInput(text)
    if (input.kind === 'invalid') {
      setMessage(`「${text}」はタイムとして読めません。例：3852 → 38.52、10523 → 1:05.23、休んだ本は -`)
      return false
    }
    setMessage(null)
    const { grid, session, swimmerIds } = latest.current
    const value = cellValueOf(input)
    if (grid[row][col] === value) return true
    saveCell(session.id!, swimmerIds[row], col + 1, value).catch((err) =>
      setMessage(`保存できませんでした: ${String(err)}`),
    )
    return true
  }, [])

  const onNavigate = useCallback(
    (row: number, col: number, key: NavKey) => {
      const pos =
        key === 'next' || key === 'prev'
          ? stepCell({ row, col }, key === 'next' ? 1 : -1, rows, cols, latest.current.order)
          : moveCell({ row, col }, key, rows, cols)
      if (pos) focusCell(pos.row, pos.col)
      else inputs.current.get(`${row}-${col}`)?.blur()
    },
    [rows, cols, focusCell],
  )

  function changeOrder(next: InputOrder) {
    setOrder(next)
    saveInputOrder(next)
  }

  function changeLaneOrder(next: LaneOrder) {
    setLaneOrder(next)
    saveLaneOrder(next)
  }

  const stats = useMemo(() => grid.map((row) => swimmerStats(toRepTimes(row))), [grid])
  const done = completedReps(filledMatrix(grid), cols)
  const filledCount = grid.flat().filter((v) => v !== undefined).length
  const emptyCount = rows * cols - filledCount
  const repNumbers = Array.from({ length: cols }, (_, i) => i + 1)

  async function finish(force: boolean) {
    if (emptyCount > 0 && !force) {
      setConfirmFinish(true)
      return
    }
    try {
      await finishSession(session.id!)
      onShowResult(session.id!)
    } catch (err) {
      setConfirmFinish(false)
      setMessage(`測定を終了できませんでした: ${String(err)}`)
    }
  }

  return (
    <div className="page input-page">
      <div className="session-head">
        <h3>{sessionTitle(session)}</h3>
        <span className="hint">
          {rows}人
          {session.circle && `・サークル ${session.circle}`}
          {session.memo && `・${session.memo}`}
        </span>
        <span className="head-actions">
          {onEdit && <button onClick={onEdit}>測定情報を編集</button>}
          {finished ? (
            <button className="primary" onClick={() => onShowResult(session.id!)}>
              結果を見る
            </button>
          ) : (
            !confirmFinish && (
              <button className="primary" onClick={() => finish(false)}>
                測定終了
              </button>
            )
          )}
        </span>
      </div>

      {finished && (
        <p className="finished-note">この測定は終了済みです。ここで直したタイムは、そのまま結果に反映されます。</p>
      )}

      {confirmFinish && (
        <div className="finish-confirm" role="alert">
          <span>
            未入力のマスが <strong>{emptyCount}件</strong>{' '}
            あります。未入力の本は平均に含まれません。測定を終了しますか？（終了後もタイムは直せます）
          </span>
          <button className="primary" onClick={() => finish(true)}>
            終了する
          </button>
          <button onClick={() => setConfirmFinish(false)}>入力に戻る</button>
        </div>
      )}

      {editPanel}

      <div className="toolbar">
        <div className="progress">
          <span>
            全員入力済み <strong className="num">{done}</strong> / {cols}本
          </span>
          <span className="progress-bar">
            <span style={{ width: `${(filledCount / (rows * cols)) * 100}%` }} />
          </span>        </div>
        <div className="order-switch" role="radiogroup" aria-label="Enterで進む向き">
          <span className="hint">Enter で進む向き：</span>
          <button
            role="radio"
            aria-checked={order === 'byRep'}
            className={order === 'byRep' ? 'preset selected' : 'preset'}
            onClick={() => changeOrder('byRep')}
          >
            ↓ 本数順（同じ本の次の選手）
          </button>
          <button
            role="radio"
            aria-checked={order === 'bySwimmer'}
            className={order === 'bySwimmer' ? 'preset selected' : 'preset'}
            onClick={() => changeOrder('bySwimmer')}
          >
            → 選手順（同じ選手の次の本）
          </button>
        </div>
        {withLanes && (
          <div className="order-switch" role="radiogroup" aria-label="選手の並び">
            <span className="hint">並び：</span>
            {LANE_ORDER_LABELS.map(({ value, label }) => (
              <button
                key={value}
                role="radio"
                aria-checked={laneOrder === value}
                className={laneOrder === value ? 'preset selected' : 'preset'}
                onClick={() => changeLaneOrder(value)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}
      <div className="grid-scroll">
        <table className="time-grid">
          <thead>
            <tr>
              <th className="name-col">選手</th>
              <th className="avg-col">平均</th>
              {repNumbers.map((r) => (
                <th key={r} className={r === done + 1 ? 'num current-rep' : 'num'}>
                  {r}
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
                  <th className="name-col">
                    {withLanes && (
                      <span className={lanes[r] == null ? 'lane-badge none' : 'lane-badge'} title="レーン">
                        {lanes[r] ?? '－'}
                      </span>
                    )}
                    {names[r]}
                  </th>
                  <td className="avg-col num">{formatTime(s.average)}</td>
                  {row.map((value, c) => (
                    <TimeCell
                      key={c}
                      row={r}
                      col={c}
                      value={value}
                      diff={s.diffs[c]}
                      highlight={c === done}                      onCommit={onCommit}
                      onNavigate={onNavigate}
                      registerInput={registerInput}
                    />
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

      <ul className="help hint">
        <li>
          入力例：<code>3852</code> → 38.52、<code>10523</code> → 1:05.23（<code>38.52</code> や <code>1:05.23</code> もそのまま入力できます）
        </li>
        <li>
          <kbd>Enter</kbd> で確定して次のマスへ（<kbd>Shift</kbd>+<kbd>Enter</kbd> で前へ）、矢印キーで移動、<kbd>Esc</kbd> で入力を取り消し
        </li>
        <li>
          休んだ本は <code>-</code>（平均から除外）、消すときは空にして <kbd>Enter</kbd>
        </li>
        <li>入力した内容はその場で自動保存されます。</li>
      </ul>
    </div>
  )
}
