import { backupFileName, exportData, type BackupData } from '../repo/backup'

export const LAST_BACKUP_KEY = 'swim-timer:lastBackupAt'

/** バックアップのファイルを、端末のダウンロードフォルダに保存する */
export function download(data: BackupData) {
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

/** 今の記録を書き出して保存し、書き出した日時を覚えておく。書き出した日時（ISO 8601）を返す */
export async function downloadBackup(): Promise<string> {
  const data = await exportData()
  download(data)
  try {
    localStorage.setItem(LAST_BACKUP_KEY, data.exportedAt)
  } catch {
    // 記録できなくても書き出しは成功している
  }
  return data.exportedAt
}
