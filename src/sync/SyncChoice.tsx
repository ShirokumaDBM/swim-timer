import { useState } from 'react'
import { downloadBackup } from '../pages/downloadBackup'
import { chooseCloud, chooseUpload, dismissChoice, useSyncStatus } from './manager'
import './SyncChoice.css'

/** 初めてクラウドと同期するとき、この端末にもともとある記録をどうするか選んでもらう */
export function SyncChoice() {
  const status = useSyncStatus()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [backedUp, setBackedUp] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choice = status.choice
  if (status.phase !== 'needsChoice' || !choice || status.choiceDismissed) return null
  const c = choice.localCounts
  const local = `選手 ${c.swimmers}人・測定 ${c.sessions}件・タイム ${c.times}件`

  async function act(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const backupButton = (
    <button
      disabled={busy}
      onClick={() =>
        act(async () => {
          await downloadBackup()
          setBackedUp(true)
        })
      }
    >
      {backedUp ? 'バックアップを書き出しました' : 'この端末の記録をバックアップに書き出す'}
    </button>
  )

  return (
    // ボタンなどの見た目は、各画面と同じもの（.page の中の部品）を使う
    <section className="page card sync-choice" role="region" aria-label="クラウドとの同期の開始">
      {choice.canUpload ? (
        <>
          <h3>この端末の記録をクラウドに載せますか？</h3>
          <p>
            クラウドにはまだ部の記録がありません。この端末の記録（{local}）をクラウドに載せると、
            承認された部員がそれぞれの端末で見られるようになります。
          </p>
          <div className="actions">
            <button className="primary" disabled={busy} onClick={() => act(chooseUpload)}>
              クラウドに載せて共有する
            </button>
            <button disabled={busy} onClick={dismissChoice}>
              あとで
            </button>
          </div>
        </>
      ) : (
        <>
          <h3>{choice.cloudHasData ? 'クラウドの部の記録に切り替えます' : 'クラウドにはまだ記録がありません'}</h3>
          {choice.cloudHasData ? (
            <p>
              クラウドにはすでに部の記録があります。この端末の記録（{local}）は、切り替えると消えて、
              クラウドの記録に置き換わります。この端末にしかない記録があれば、先にバックアップに書き出してください。
            </p>
          ) : (
            <p>
              管理者か入力担当が記録をクラウドに載せると、ここで見られるようになります。
              この端末の記録（{local}）を消してクラウドに切り替えておくこともできます。
            </p>
          )}
          <div className="actions">
            {backupButton}
            {confirming ? (
              <>
                <span className="confirm-text">この端末の記録を消して切り替えます。よろしいですか？</span>
                <button className="danger" disabled={busy} onClick={() => act(chooseCloud)}>
                  消して切り替える
                </button>
                <button disabled={busy} onClick={() => setConfirming(false)}>
                  やめる
                </button>
              </>
            ) : (
              <>
                <button className="primary" disabled={busy} onClick={() => setConfirming(true)}>
                  クラウドの記録に切り替える
                </button>
                <button disabled={busy} onClick={dismissChoice}>
                  あとで
                </button>
              </>
            )}
          </div>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
