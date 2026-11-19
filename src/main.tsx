import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startAuth } from './cloud/auth'
import { startSync } from './sync/manager'
import { migrateLegacyData } from './repo/legacy'

// ブラウザの容量が足りなくなったときに、記録が自動で消されないようにする
navigator.storage?.persist?.().catch(() => {})

// 以前の形式で保存された記録があれば、画面を出す前に今の形式へ写す（一度だけ）。
// 失敗しても画面は出す（旧データは消していないので、次の起動でもう一度試す）
migrateLegacyData()
  .catch((err) => console.error('以前の記録を移せませんでした', err))
  .finally(() => {
    // ログイン状態の確認を始める（ログインしていなくても、これまでどおり端末の中だけで使える）
    startAuth()
    // 承認された人がログインしている間は、クラウドと同期する
    startSync()
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
