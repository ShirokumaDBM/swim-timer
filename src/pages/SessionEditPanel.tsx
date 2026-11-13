import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { draftFromSession, draftToInput, timesRemovedBy, type SessionDraft } from '../domain/sessionDraft'
import type { Session, Swimmer, TimeRecord } from '../domain/types'
import { normalizeSessionInput, SessionError, updateSession } from '../repo/sessions'
import { listSwimmers } from '../repo/swimmers'
import { SessionFields } from './SessionFields'
import './SessionEditPanel.css'

interface Props {
  session: Session
  /** 今入力されているタイム（消えるタイムの確認に使う） */
  records: TimeRecord[]
  onClose: () => void
}

/** 入力中の測定の設定を変更する */
export function SessionEditPanel({ session, records, onClose }: Props) {
  const swimmers = useLiveQuery(listSwimmers)
  if (!swimmers) return null
  return <EditForm session={session} records={records} swimmers={swimmers} onClose={onClose} />
}

function EditForm({ session, records, swimmers, onClose }: Props & { swimmers: Swimmer[] }) {
  const allIds = swimmers.map((s) => s.id!)
  const [draft, setDraft] = useState<SessionDraft>(() => draftFromSession(session, allIds))
  const [error, setError] = useState<string | null>(null)
  /** 消えるタイムがあるときの確認中 */
  const [confirming, setConfirming] = useState<string | null>(null)

  function change(patch: Partial<SessionDraft>) {
    setError(null)
    setConfirming(null)
    setDraft((prev) => ({ ...prev, ...patch }))
  }

  /** 消えるタイムの説明（なければ null） */
  function removalMessage(swimmerIds: number[], reps: number): string | null {
    const removed = timesRemovedBy(records, swimmerIds, reps)
    if (removed.length === 0) return null
    const keep = new Set(swimmerIds)
    const dropped = [...new Set(removed.filter((t) => !keep.has(t.swimmerId)).map((t) => t.swimmerId))].map(
      (id) => swimmers.find((s) => s.id === id)?.name ?? '（削除された選手）',
    )
    const reasons = [
      dropped.length > 0 && `外した選手（${dropped.join('、')}）のタイム`,
      removed.some((t) => t.rep > reps) && `${reps + 1}本目以降のタイム`,
    ].filter(Boolean)
    return `${reasons.join('と、')}が消えます（${removed.length}件）。`
  }

  async function save(force: boolean) {
    const input = draftToInput(draft, allIds)
    try {
      // 先に入力の誤りを確かめてから、消えるタイムを確認する
      const data = normalizeSessionInput(input)
      const message = removalMessage(data.swimmerIds, data.reps)
      if (message && !force) {
        setConfirming(message)
        return
      }
      await updateSession(session.id!, input)
      onClose()
    } catch (err) {
      setConfirming(null)
      setError(err instanceof SessionError ? err.message : `保存できませんでした: ${String(err)}`)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    save(false)
  }

  return (
    <form className="card session-form session-edit" onSubmit={submit} aria-label="測定情報の編集">
      <h4>測定情報の編集</h4>
      <SessionFields draft={draft} onChange={change} swimmers={swimmers} />

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {confirming ? (
        <div className="submit-row confirm">
          <span className="confirm-text">{confirming}よろしいですか？</span>
          <button type="button" className="danger" onClick={() => save(true)}>
            タイムを消して保存
          </button>
          <button type="button" onClick={() => setConfirming(null)}>
            戻る
          </button>
        </div>
      ) : (
        <div className="submit-row">
          <button type="submit" className="primary">
            保存
          </button>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
        </div>
      )}
    </form>
  )
}
