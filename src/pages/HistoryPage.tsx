import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { formatDate } from '../domain/date'
import { conditionKey, conditionOptions, previousAverage, type HistoryRow } from '../domain/history'
import { sessionMenu } from '../domain/sessionLabel'
import { formatDiff, formatTime } from '../domain/time'
import { loadHistory } from '../repo/results'
import { deleteSession } from '../repo/sessions'
import { listSwimmers } from '../repo/swimmers'
import './HistoryPage.css'

interface Props {
  onOpenResult: (sessionId: number) => void
  onOpenChart: (sessionId: number, swimmerId?: number) => void
  onOpenInput: (sessionId: number) => void
}

export function HistoryPage({ onOpenResult, onOpenChart, onOpenInput }: Props) {
  const rows = useLiveQuery(loadHistory)
  const swimmers = useLiveQuery(listSwimmers)
  const [condition, setCondition] = useState('')
  const [swimmerId, setSwimmerId] = useState<number | null>(null)
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!rows || !swimmers) return <p>読み込み中…</p>
  if (rows.length === 0) {
    return (
      <div className="page">
        <p className="empty">測定がまだありません。</p>
      </div>
    )
  }

  const options = conditionOptions(rows)
  // 絞り込み（前回との差は絞り込む前の並びで探す）
  const visible = rows
    .map((row, index) => ({ row, index }))
    .filter(
      ({ row }) =>
        (condition === '' || conditionKey(row.session) === condition) &&
        (swimmerId == null || row.session.swimmerIds.includes(swimmerId)),
    )
  const swimmerName = swimmers.find((s) => s.id === swimmerId)?.name

  async function remove(id: number) {
    try {
      await deleteSession(id)
      setConfirmingId(null)
      setError(null)
    } catch (err) {
      setError(`削除できませんでした: ${String(err)}`)
    }
  }

  return (
    <div className="page history-page">
      <div className="history-filters">
        <label>
          条件
          <select value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="">すべて</option>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {sessionMenu(o)}（{o.count}回）
              </option>
            ))}
          </select>
        </label>
        <label>
          選手
          <select
            value={swimmerId ?? ''}
            onChange={(e) => setSwimmerId(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">すべての選手</option>
            {swimmers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <span className="hint">
          {visible.length}件の測定
          {swimmerName && `（${swimmerName}が参加した測定）`}
        </span>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="empty">条件に合う測定がありません。</p>
      ) : (
        <div className="card table-card">
          <table className="history-table">
            <thead>
              <tr>
                <th>測定日</th>
                <th>メニュー</th>
                <th className="right">人数</th>
                {swimmerId != null ? (
                  <>
                    <th className="right">{swimmerName}の平均</th>
                    <th>前回との差</th>
                  </>
                ) : (
                  <th className="right">入力済み</th>
                )}
                <th>メモ</th>
                <th>状態</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map(({ row, index }) => (
                <HistoryLine
                  key={row.session.id}
                  row={row}
                  swimmerId={swimmerId}
                  previous={swimmerId != null ? previousAverage(rows, index, swimmerId) : null}
                  confirming={confirmingId === row.session.id}
                  onConfirm={(on) => setConfirmingId(on ? row.session.id! : null)}
                  onDelete={() => remove(row.session.id!)}
                  onOpenResult={() => onOpenResult(row.session.id!)}
                  onOpenChart={() => onOpenChart(row.session.id!, swimmerId ?? undefined)}
                  onOpenInput={() => onOpenInput(row.session.id!)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

interface LineProps {
  row: HistoryRow
  swimmerId: number | null
  previous: number | null
  confirming: boolean
  onConfirm: (on: boolean) => void
  onDelete: () => void
  onOpenResult: () => void
  onOpenChart: () => void
  onOpenInput: () => void
}

function HistoryLine({ row, swimmerId, previous, confirming, onConfirm, onDelete, ...open }: LineProps) {
  const s = row.session
  const inProgress = s.status === 'in_progress'
  const avg = swimmerId != null ? row.averages.get(swimmerId) : undefined
  const diff = avg != null && previous != null ? avg - previous : null

  return (
    <tr className={confirming ? 'confirming' : ''}>
      <td className="nowrap">{formatDate(s.date)}</td>
      <td className="nowrap">{sessionMenu(s)}</td>
      <td className="right num">{s.swimmerIds.length}人</td>
      {swimmerId != null ? (
        <>
          <td className="right num strong">{avg != null ? formatTime(avg) : '—'}</td>
          <td className="nowrap">
            {diff != null ? (
              <span className={`cmp ${diff < 0 ? 'faster' : diff > 0 ? 'slower' : 'same'}`}>
                <span className="num">{formatDiff(diff)}</span>{' '}
                <span className="cmp-label">{diff < 0 ? '▲ 改善' : diff > 0 ? '▼ 悪化' : '変化なし'}</span>
              </span>
            ) : (
              <span className="hint">—</span>
            )}
          </td>
        </>
      ) : (
        <td className="right num">
          {row.timeCount} / {s.reps * s.swimmerIds.length}
        </td>
      )}
      <td className="memo">{s.memo}</td>
      <td>{inProgress ? <span className="status-label">入力中</span> : <span className="hint">終了</span>}</td>
      <td>
        <div className="actions">
        {confirming ? (
          <>
            <span className="confirm-text">
              削除しますか？{row.timeCount > 0 && `タイム${row.timeCount}件も消えます。`}
            </span>
            <button className="danger" onClick={onDelete}>
              削除する
            </button>
            <button onClick={() => onConfirm(false)}>やめる</button>
          </>
        ) : (
          <>
            {inProgress ? (
              <button className="primary" onClick={open.onOpenInput}>
                続きを入力
              </button>
            ) : (
              <button onClick={open.onOpenResult}>結果</button>
            )}
            <button onClick={open.onOpenChart}>グラフ</button>
            <button className="danger-outline" onClick={() => onConfirm(true)}>
              削除
            </button>
          </>
        )}
        </div>
      </td>
    </tr>
  )
}
