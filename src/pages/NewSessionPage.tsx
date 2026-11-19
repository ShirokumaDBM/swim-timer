import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { todayString } from '../domain/date'
import { draftFromSession, draftToInput, emptyDraft, type SessionDraft } from '../domain/sessionDraft'
import { sessionMenu, sessionTitle } from '../domain/sessionLabel'
import type { Id, Session } from '../domain/types'
import { createSession, deleteSession, getLatestSession, listInProgressSessions, SessionError } from '../repo/sessions'
import { listSwimmers } from '../repo/swimmers'
import { countTimes } from '../repo/times'
import { usePermissions } from '../cloud/permissions'
import { useMembers } from '../cloud/useMembers'
import { SessionFields } from './SessionFields'
import './NewSessionPage.css'

/** 入力中の測定の1行（続きを入力／削除） */
function InProgressItem({
  session,
  onOpen,
  canEdit,
  canDelete,
}: {
  session: Session
  onOpen: () => void
  /** 入力できる（記録係・管理者）。できなければ「見る」 */
  canEdit: boolean
  canDelete: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timeCount = useLiveQuery(() => countTimes(session.id), [session.id])

  async function remove() {
    try {
      await deleteSession(session.id)
    } catch (err) {
      setError(`削除できませんでした: ${String(err)}`)
    }
  }

  return (
    <li className={confirming ? 'confirming' : ''}>
      <span>
        {sessionTitle(session)}（{session.swimmerIds.length}人・入力済み {timeCount ?? '…'}件）
      </span>
      <span className="actions">
        {confirming ? (
          <>
            <span className="confirm-text">
              この測定を削除しますか？{timeCount ? `入力済みのタイム ${timeCount}件も消えます。` : ''}
            </span>
            <button className="danger" onClick={remove}>
              削除する
            </button>
            <button onClick={() => setConfirming(false)}>やめる</button>
          </>
        ) : (
          <>
            <button onClick={onOpen}>{canEdit ? '続きを入力' : '見る'}</button>
            {canDelete && (
              <button className="danger-outline" onClick={() => setConfirming(true)}>
                削除
              </button>
            )}
          </>
        )}
      </span>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </li>
  )
}

interface Props {
  /** 作成した／続ける測定の入力画面へ */
  onOpenSession: (sessionId: Id) => void
  onGoSwimmers: () => void
}

export function NewSessionPage({ onOpenSession, onGoSwimmers }: Props) {
  const swimmers = useLiveQuery(listSwimmers)
  const inProgress = useLiveQuery(listInProgressSessions)
  const latest = useLiveQuery(getLatestSession)

  const [draft, setDraft] = useState<SessionDraft>(() => emptyDraft(todayString()))
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // クラウドと同期している端末では、測定を作れるのは管理者だけ。記録係は管理者が選ぶ
  const perm = usePermissions()
  const pickRecorders = perm.cloud && perm.isAdmin
  const { members, error: membersError } = useMembers(pickRecorders)

  if (!swimmers || !inProgress) return <p>読み込み中…</p>

  const allIds = swimmers.map((s) => s.id)

  function change(patch: Partial<SessionDraft>) {
    setError(null)
    setDraft((prev) => ({ ...prev, ...patch }))
  }

  function copyFrom(s: Session) {
    const copied = draftFromSession(s, allIds)
    // 測定日とメモは今回の入力のまま
    setDraft((prev) => ({ ...copied, date: prev.date, memo: prev.memo }))
    setError(null)
    setNotice(
      `${sessionTitle(s)} の設定をコピーしました。` +
        (copied.selected.size < s.swimmerIds.length ? '（削除された選手は外しました）' : ''),
    )
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    try {
      const id = await createSession(draftToInput(draft, allIds))
      onOpenSession(id)
    } catch (err) {
      setNotice(null)
      setError(err instanceof SessionError ? err.message : `作成できませんでした: ${String(err)}`)
    }
  }

  return (
    <div className="page new-session-page">
      {inProgress.length > 0 && (
        <section className="card in-progress">
          <h3>入力中の測定があります</h3>
          <ul>
            {inProgress.map((s) => (
              <InProgressItem
                key={s.id}
                session={s}
                onOpen={() => onOpenSession(s.id)}
                canEdit={perm.canEditSession(s)}
                canDelete={perm.canDeleteSession}
              />
            ))}
          </ul>
        </section>
      )}

      {!perm.canCreateSession ? (
        <section className="card">
          <p className="hint">{perm.whyNoCreate}</p>
        </section>
      ) : (
      <form
        className="card session-form"
        onSubmit={submit}
        // 入力を直したら古いエラーは消す（ボタン操作は click で拾う。送信時のエラーは click の後に出る）
        onChange={() => setError(null)}
        onClickCapture={(e) => {
          if ((e.target as HTMLElement).closest('button[type=button]')) setError(null)
        }}
      >
        {latest && (
          <div className="copy-row">
            <button type="button" onClick={() => copyFrom(latest)}>
              前回の設定をコピー
            </button>
            <span className="hint">
              前回：{sessionTitle(latest)}・{latest.swimmerIds.length}人
            </span>
          </div>
        )}

        <SessionFields
          draft={draft}
          onChange={change}
          swimmers={swimmers}
          onGoSwimmers={onGoSwimmers}
          recorderOptions={pickRecorders ? members : undefined}
          recorderError={pickRecorders ? membersError : undefined}
        />

        {notice && <p className="notice">{notice}</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="submit-row">
          <button type="submit" className="primary big">
            測定を開始
          </button>
          {draft.reps && Number(draft.distance) > 0 && (
            <span className="hint">
              {sessionMenu({ distance: Number(draft.distance), reps: Number(draft.reps), stroke: draft.stroke })}・
              {draft.selected.size}人
            </span>
          )}
        </div>
      </form>
      )}
    </div>
  )
}
