import { useEffect, useRef, useState } from 'react'
import { reloadMember, signInWithDiscord, signOut, useAuth } from './auth'
import { syncNow, useSyncStatus, type SyncStatus } from '../sync/manager'
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from './members'
import './AccountMenu.css'

/** ヘッダー右上：ログイン・ログアウトと、自分の役割の表示 */
/** 同期の状態の短い説明（同期していないときは null） */
function syncText(s: SyncStatus): string | null {
  switch (s.phase) {
    case 'off':
      return null
    case 'syncing':
      return '同期中…'
    case 'idle':
      return s.pending > 0 ? `送信待ち ${s.pending}件` : '同期済み'
    case 'offline':
      return s.pending > 0 ? `電波なし（送信待ち ${s.pending}件）` : '電波なし'
    case 'error':
      return '同期できませんでした'
    case 'needsChoice':
      return '同期の開始待ち'
  }
}

export function AccountMenu() {
  const auth = useAuth()
  const sync = useSyncStatus()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  // メニューの外を押したら閉じる
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  if (auth.status === 'loading') return <div className="account" aria-busy="true" />

  if (auth.status === 'signedOut') {
    return (
      <div className="account">
        <button
          className="login-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await signInWithDiscord()
            setBusy(false)
          }}
        >
          {busy ? '移動中…' : 'Discord でログイン'}
        </button>
        {auth.error && (
          <p className="account-error" role="alert">
            {auth.error}
          </p>
        )}
      </div>
    )
  }

  const role = auth.member?.role ?? 'pending'
  const syncLabel = syncText(sync)
  return (
    <div className="account" ref={box}>
      <button className="account-button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {auth.user.avatarUrl ? <img src={auth.user.avatarUrl} alt="" className="avatar" /> : <span className="avatar empty" />}
        <span className="account-name">{auth.user.name}</span>
        <span className={`role-badge ${role}`}>{ROLE_LABELS[role]}</span>
        {syncLabel && (
          <span className={`sync-dot ${sync.phase}${sync.pending > 0 ? ' pending' : ''}`} title={syncLabel} aria-label={syncLabel} />
        )}
      </button>
      {open && (
        <div className="account-panel" role="dialog" aria-label="アカウント">
          <p className="panel-name">{auth.user.name}</p>
          <p>
            役割：<strong>{ROLE_LABELS[role]}</strong>
            <br />
            <span className="hint">{ROLE_DESCRIPTIONS[role]}</span>
          </p>
          {role === 'pending' && (
            <p className="hint">管理者が承認すると、部の記録を見られるようになります。承認されたら下のボタンで確かめてください。</p>
          )}
          {auth.memberError && <p className="account-error">{auth.memberError}</p>}
          {syncLabel && (
            <div className="panel-sync">
              <p>
                クラウド：<strong>{syncLabel}</strong>
                {sync.lastSyncedAt && (
                  <span className="hint">（{new Date(sync.lastSyncedAt).toLocaleTimeString('ja-JP')} に同期）</span>
                )}
              </p>
              {sync.phase === 'offline' && (
                <p className="hint">電波が戻ると自動で送ります。入力した記録は、この端末に保存されています。</p>
              )}
              {sync.error && <p className="account-error">{sync.error}</p>}
              {!!sync.rejected && (
                <p className="hint">
                  権限のない記録の変更（{sync.rejected}件）は、クラウドの内容に戻しました。
                  タイムを入力・修正できるのは、その測定の記録係（入力中の間）と管理者です。
                </p>
              )}
            </div>
          )}
          <div className="panel-actions">
            {syncLabel && sync.phase !== 'needsChoice' && (
              <button disabled={sync.phase === 'syncing'} onClick={() => void syncNow()}>
                今すぐ同期
              </button>
            )}
            <button onClick={() => void reloadMember()}>役割を確かめ直す</button>
            <button
              onClick={async () => {
                setOpen(false)
                await signOut()
              }}
            >
              ログアウト
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
