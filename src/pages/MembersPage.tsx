import { useEffect, useState } from 'react'
import { reloadMember, useAuth } from '../cloud/auth'
import { listMembers, MemberError, ROLE_DESCRIPTIONS, ROLE_LABELS, updateMemberRole, type Member, type Role } from '../cloud/members'
import './MembersPage.css'

const ROLES: Role[] = ['pending', 'member', 'admin']

/** 部員名簿：承認と役割の変更（管理者だけ） */
export function MembersPage() {
  const auth = useAuth()
  const [members, setMembers] = useState<Member[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const isAdmin = auth.status === 'signedIn' && auth.member?.role === 'admin'

  // 管理者として表示したとき・変更したとき・「最新にする」を押したときに、名簿をクラウドから読み込む
  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    listMembers().then(
      (list) => {
        if (!cancelled) setMembers(list)
      },
      (err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      },
    )
    return () => {
      cancelled = true
    }
  }, [isAdmin, version])

  if (auth.status !== 'signedIn' || !isAdmin) {
    return (
      <div className="page">
        <p className="empty">部員名簿は、管理者が Discord でログインすると表示されます。</p>
      </div>
    )
  }

  async function change(m: Member, role: Role) {
    setSavingId(m.userId)
    setError(null)
    try {
      await updateMemberRole(m.userId, role)
      setVersion((v) => v + 1)
      // 自分の役割を変えたときは、画面の表示（メニューなど）も合わせる
      if (auth.status === 'signedIn' && m.userId === auth.user.id) await reloadMember()
    } catch (err) {
      setError(err instanceof MemberError ? err.message : `変更できませんでした（${String(err)}）`)
    } finally {
      setSavingId(null)
    }
  }

  const pending = members?.filter((m) => m.role === 'pending').length ?? 0

  return (
    <div className="page members-page">
      <section className="card">
        <p className="hint">
          Discord でログインした人が、ここに並びます。部の人だと確かめてから、役割を選んで承認してください。
          記録係は、測定ごとに「新規測定」「測定情報を編集」で指名します。
        </p>
        <ul className="role-help hint">
          {ROLES.map((r) => (
            <li key={r}>
              <strong>{ROLE_LABELS[r]}</strong>：{ROLE_DESCRIPTIONS[r]}
            </li>
          ))}
        </ul>
      </section>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!members ? (
        <p>読み込み中…</p>
      ) : (
        <section className="card">
          <div className="members-head">
            <h3>
              部員名簿 <span className="hint">{members.length}人{pending > 0 && `（承認待ち ${pending}人）`}</span>
            </h3>
            <button onClick={() => setVersion((v) => v + 1)}>最新にする</button>
          </div>
          <ul className="member-list">
            {members.map((m) => (
              <li key={m.userId} className={m.role === 'pending' ? 'member-row pending' : 'member-row'}>
                <div className="who">
                  {m.avatarUrl ? <img src={m.avatarUrl} alt="" className="avatar" /> : <span className="avatar empty" />}
                  <div>
                    <div className="name">
                      {m.displayName || '（名前なし）'}
                      {m.userId === auth.user.id && <span className="me">あなた</span>}
                    </div>
                    <div className="hint">初めてのログイン：{new Date(m.createdAt).toLocaleDateString('ja-JP')}</div>
                  </div>
                </div>
                <label>
                  役割
                  <select
                    value={m.role}
                    disabled={savingId === m.userId}
                    onChange={(e) => void change(m, e.target.value as Role)}
                    aria-label={`${m.displayName}の役割`}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </label>
                {m.role === 'pending' && (
                  <button className="primary" disabled={savingId === m.userId} onClick={() => void change(m, 'member')}>
                    部員として承認
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
