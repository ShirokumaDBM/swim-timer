import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState, type ChangeEvent } from 'react'
import {
  BackupError,
  backupFileName,
  currentSummary,
  exportData,
  importData,
  parseBackup,
  summarize,
  type BackupData,
  type DataSummary,
} from '../repo/backup'
import './BackupPage.css'

const LAST_BACKUP_KEY = 'swim-timer:lastBackupAt'

function loadLastBackup(): string | null {
  try {
    return localStorage.getItem(LAST_BACKUP_KEY)
  } catch {
    return null
  }
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '不明'
  return d.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

const summaryText = (s: DataSummary) => `選手 ${s.swimmers}人・測定 ${s.sessions}件・タイム ${s.times}件`

function download(data: BackupData) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = backupFileName(new Date(data.exportedAt))
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function BackupPage() {
  const summary = useLiveQuery(currentSummary)
  const [lastBackup, setLastBackup] = useState(loadLastBackup)
  const [pending, setPending] = useState<{ name: string; data: BackupData } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  if (!summary) return <p>読み込み中…</p>

  async function onExport() {
    setError(null)
    setDone(null)
    try {
      const data = await exportData()
      download(data)
      try {
        localStorage.setItem(LAST_BACKUP_KEY, data.exportedAt)
      } catch {
        // 記録できなくても書き出しは成功している
      }
      setLastBackup(data.exportedAt)
      setDone('バックアップを書き出しました。ダウンロードフォルダを確認してください。')
    } catch (err) {
      setError(`書き出せませんでした: ${String(err)}`)
    }
  }

  async function onFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // 同じファイルを選び直せるように
    setError(null)
    setDone(null)
    setPending(null)
    if (!file) return
    try {
      setPending({ name: file.name, data: parseBackup(await file.text()) })
    } catch (err) {
      setError(err instanceof BackupError ? err.message : `読み込めませんでした: ${String(err)}`)
    }
  }

  async function onConfirmImport() {
    if (!pending) return
    try {
      await importData(pending.data)
      setDone(`「${pending.name}」を読み込みました（${summaryText(summarize(pending.data))}）。`)
      setPending(null)
    } catch (err) {
      setError(`読み込めませんでした（データは変更されていません）: ${String(err)}`)
    }
  }

  const stale = lastBackup === null || daysSince(lastBackup) >= 7
  const isEmpty = summary.swimmers + summary.sessions === 0

  return (
    <div className="page backup-page">
      <p className="intro">
        データはこの PC のブラウザの中にだけ保存されています。ブラウザの履歴・サイトデータを消したり、PC を買い替えたりすると記録も消えるため、
        <strong>測定のあとにバックアップを書き出して</strong>、USB メモリやクラウドなど別の場所にも保存しておいてください。
      </p>

      {done && <p className="done">{done}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="card">
        <h3>バックアップを書き出す</h3>
        <p>
          今のデータ：<strong>{summaryText(summary)}</strong>
        </p>
        <p className={stale && !isEmpty ? 'last-backup warn' : 'last-backup'}>
          前回の書き出し：
          {lastBackup ? `${formatDateTime(lastBackup)}（${daysSince(lastBackup)}日前）` : 'まだありません'}
        </p>
        <button className="primary big" onClick={onExport} disabled={isEmpty}>
          バックアップを書き出す（JSON）
        </button>
      </section>

      <section className="card">
        <h3>バックアップから戻す</h3>
        <p>
          書き出したファイルを選ぶと、中身を確認してから読み込みます。
          <strong>今のデータはすべてファイルの内容に置き換わります。</strong>
        </p>
        <input ref={fileInput} type="file" accept=".json,application/json" onChange={onFileSelected} hidden />
        {!pending && <button onClick={() => fileInput.current?.click()}>ファイルを選ぶ…</button>}

        {pending && (
          <div className="confirm-box">
            <p>
              <strong>{pending.name}</strong>
              <br />
              書き出した日時：{formatDateTime(pending.data.exportedAt)}
              <br />
              中身：{summaryText(summarize(pending.data))}
            </p>
            <p className="warn">
              今のデータ（{summaryText(summary)}）は消えて、このファイルの内容に置き換わります。
              {!isEmpty && '心配な場合は、先に今のデータを書き出してください。'}
            </p>
            <div className="buttons">
              <button className="danger" onClick={onConfirmImport}>
                置き換えて読み込む
              </button>
              <button onClick={() => setPending(null)}>やめる</button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
