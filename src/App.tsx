import { lazy, Suspense, useState } from 'react'
import './App.css'
import type { Id } from './domain/types'
import { AccountMenu } from './cloud/AccountMenu'
import { useAuth } from './cloud/auth'
import { BackupPage } from './pages/BackupPage'
import { HistoryPage } from './pages/HistoryPage'
import { MembersPage } from './pages/MembersPage'
import { InputPage } from './pages/InputPage'
import { NewSessionPage } from './pages/NewSessionPage'
import { ResultPage } from './pages/ResultPage'
import { SwimmersPage } from './pages/SwimmersPage'
import { SyncChoice } from './sync/SyncChoice'

// グラフのライブラリは大きいので、グラフ画面を開いたときに読み込む
const ChartPage = lazy(() => import('./pages/ChartPage').then((m) => ({ default: m.ChartPage })))

type PageKey = 'swimmers' | 'new' | 'input' | 'result' | 'history' | 'chart' | 'backup' | 'members'

const PAGES: { key: PageKey; label: string }[] = [
  { key: 'swimmers', label: '選手管理' },
  { key: 'new', label: '新規測定' },
  { key: 'input', label: '測定入力' },
  { key: 'result', label: '結果' },
  { key: 'history', label: '履歴' },
  { key: 'chart', label: 'グラフ' },
  { key: 'backup', label: 'バックアップ' },
  // 管理者がログインしているときだけ表示する
  { key: 'members', label: '部員' },
]

function App() {
  const [page, setPage] = useState<PageKey>('swimmers')
  /** 測定入力画面で開く測定（未指定なら一番新しい入力中のもの） */
  const [sessionId, setSessionId] = useState<Id | undefined>()
  /** 結果画面で開く測定（未指定なら一番新しい終了した測定） */
  const [resultId, setResultId] = useState<Id | undefined>()
  /** グラフ画面で最初に開く測定と選手（未指定なら一番新しい測定） */
  const [chartTarget, setChartTarget] = useState<{ sessionId?: Id; swimmerId?: Id }>({})
  const auth = useAuth()
  const isAdmin = auth.status === 'signedIn' && auth.member?.role === 'admin'
  const current = PAGES.find((p) => p.key === page)!

  function openSession(id: Id) {
    setSessionId(id)
    setPage('input')
  }

  function showChart(id: Id, swimmerId?: Id) {
    setChartTarget({ sessionId: id, swimmerId })
    setPage('chart')
  }

  function showResult(id: Id) {
    setResultId(id)
    // 測定入力タブは次に入力中の測定を開く
    setSessionId(undefined)
    setPage('result')
  }

  function renderPage() {
    switch (page) {
      case 'swimmers':
        return <SwimmersPage />
      case 'new':
        return <NewSessionPage onOpenSession={openSession} onGoSwimmers={() => setPage('swimmers')} />
      case 'input':
        return <InputPage sessionId={sessionId} onGoNew={() => setPage('new')} onShowResult={showResult} />
      case 'result':
        return (
          <ResultPage
            sessionId={resultId}
            onEditTimes={openSession}
            onShowChart={showChart}
            onGoInput={() => setPage('input')}
          />
        )
      case 'history':
        return <HistoryPage onOpenResult={showResult} onOpenChart={showChart} onOpenInput={openSession} />
      case 'chart':
        return (
          <Suspense fallback={<p>読み込み中…</p>}>
            <ChartPage
              key={`${chartTarget.sessionId}-${chartTarget.swimmerId}`}
              initialSessionId={chartTarget.sessionId}
              initialSwimmerId={chartTarget.swimmerId}
            />
          </Suspense>
        )
      case 'members':
        return <MembersPage />
      case 'backup':
        return <BackupPage />
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand-row">
          <h1>スイムタイマー</h1>
          <AccountMenu />
        </div>
        <nav>
          {PAGES.filter((p) => p.key !== 'members' || isAdmin).map((p) => (
            <button
              key={p.key}
              className={p.key === page ? 'active' : ''}
              onClick={() => setPage(p.key)}
            >
              {p.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="app-main">
        <SyncChoice />
        <h2>{current.label}</h2>
        {renderPage()}
      </main>
    </div>
  )
}

export default App
